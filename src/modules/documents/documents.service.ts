import { randomUUID } from "node:crypto";

import { documentsConfig } from "@/config/documents";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/errors";
import { logEvent } from "@/lib/events";
import { decodeCursor, encodeCursor } from "@/lib/pagination";
import {
  getPaperlessDocument,
  getPaperlessDocumentHistory,
  getPaperlessDocumentTypeName,
  toDocumentTypeKey,
  updatePaperlessDocument
} from "@/lib/paperless/documents";
import { paperlessFor } from "@/lib/paperless/client";
import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ServiceContext } from "@/lib/service-context";
import {
  getConnections,
  listConnectedIds,
  type ConnectionWithOther
} from "@/modules/connections/connections.service";
import { getMembership } from "@/modules/organizations/organizations.service";
import type { Database } from "@/types/database";

export type DocumentUpload = Database["public"]["Tables"]["document_uploads"]["Row"];
export type Document = Database["public"]["Tables"]["documents"]["Row"];

const RECENT_LIST_LIMIT = 50;
const DEFAULT_PAGE_SIZE = 25;
// specs/05-level-1-structure.md: "Cap the Paperless id set and paginate carefully — this is the
// one place where naive implementation will not scale past a few thousand documents." — the
// q/tag search's own page size, a separate concern from the bulk-endpoint id cap below (this
// one conflated both until Phase 3 M7; nothing actually needed them to be the same number).
const MAX_PAPERLESS_ID_SET = 2000;
// specs/03-api.md: "Bulk endpoints cap at 1,000 ids per request" — every current
// listDocumentIds() caller (bulk connect, bulk export, the filter-match counter) is exactly
// such an endpoint, so this is the real default, not the Paperless search page size above.
const BULK_ID_CAP = 1000;

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-150);
}

type UploadIntentInput = { filename: string; size: number; mimeType: string };
type UploadIntentResult = { uploadId: string; signedUrl: string; token: string; path: string };

// specs/01-architecture.md §Upload step 1. The user's own RLS-scoped client does the
// document_uploads insert (so has_organization_write_access() rejects a read-only member for
// free); the admin client generates the signed URL, since storage.objects has no RLS grant for
// authenticated users at all (this migration's own comment — the token is the auth mechanism).
export async function createUploadIntent(
  userId: string,
  organizationId: string,
  input: UploadIntentInput
): Promise<UploadIntentResult> {
  if (input.size <= 0 || input.size > documentsConfig.maxSizeBytes) {
    throw new ValidationError(
      `File size must be between 1 byte and ${documentsConfig.maxSizeBytes} bytes`
    );
  }
  if (!documentsConfig.allowedMimeTypes.includes(input.mimeType)) {
    throw new ValidationError(`File type is not allowed: ${input.mimeType}`);
  }

  const path = `${organizationId}/${randomUUID()}-${sanitizeFilename(input.filename)}`;
  const expiresAt = new Date(
    Date.now() + documentsConfig.pendingExpiryMinutes * 60 * 1000
  ).toISOString();

  const db = await createClient();
  const { data: upload, error: insertError } = await db
    .from("document_uploads")
    .insert({
      organization_id: organizationId,
      storage_path: path,
      filename: input.filename,
      declared_mime_type: input.mimeType,
      size_bytes: input.size,
      created_by: userId,
      expires_at: expiresAt
    })
    .select("id")
    .single();

  if (insertError) throw insertError;

  const admin = createAdminClient();
  const { data: signed, error: signError } = await admin.storage
    .from(documentsConfig.bucket)
    .createSignedUploadUrl(path);

  if (signError) {
    // Compensating cleanup — the row would otherwise sit 'pending' with no way to ever upload.
    await db.from("document_uploads").delete().eq("id", upload.id);
    throw signError;
  }

  return { uploadId: upload.id, signedUrl: signed.signedUrl, token: signed.token, path };
}

// specs/01-architecture.md §Upload steps 2-3. Confirms the object actually landed in storage
// (never trust the client's say-so) before handing off to the worker pipeline.
export async function completeUpload(userId: string, uploadId: string): Promise<DocumentUpload> {
  const db = await createClient();
  const { data: upload, error } = await db
    .from("document_uploads")
    .select("*")
    .eq("id", uploadId)
    .maybeSingle();

  if (error) throw error;
  if (!upload) throw new NotFoundError("Upload not found");
  if (upload.created_by !== userId) {
    throw new AuthorizationError("You can only complete your own uploads");
  }
  if (upload.status !== "pending") {
    throw new ValidationError(`Upload is not pending (status: ${upload.status})`);
  }

  const admin = createAdminClient();
  const dir = upload.storage_path.split("/").slice(0, -1).join("/");
  const filename = upload.storage_path.split("/").at(-1) ?? "";
  const { data: listing, error: listError } = await admin.storage
    .from(documentsConfig.bucket)
    .list(dir, { search: filename });

  if (listError) throw listError;
  if (!listing.some((f) => f.name === filename)) {
    throw new ValidationError("File was not found in storage — upload may have failed or expired");
  }

  const { data: updated, error: updateError } = await admin
    .from("document_uploads")
    .update({ status: "uploaded" })
    .eq("id", uploadId)
    .select("*")
    .single();

  if (updateError) throw updateError;

  await enqueue(QUEUE_NAMES.ingestDocument, {
    orgId: upload.organization_id,
    uploadId: upload.id
  });

  return updated;
}

export type ListDocumentsOptions = {
  documentTypeKey?: string;
  dateFrom?: string; // yyyy-mm-dd
  dateTo?: string;
  status?: Document["status"];
  // Not mirrored locally (no second search engine, per specs/00's non-goals) — always
  // Paperless-delegated. `tag` isn't mirrored either (only correspondent_name/document_type_key
  // are), so it's delegated too.
  q?: string;
  tag?: string;
  // Business filters — served entirely from our own DB, never sent to Paperless.
  entityId?: string;
  hasNoConnections?: boolean;
  cursor?: string | null;
  limit?: number;
};

const LIST_DOCUMENT_COLUMNS =
  "id, organization_id, paperless_document_id, title, document_type_key, document_date, correspondent_name, page_count, byte_size, mime_type, checksum, status, source, import_job_id, synced_at, created_by, created_at, updated_at, deleted_at" as const;

// Resolves the `q`/`tag` Paperless-first id set — factored out so listDocumentIds() can call
// it once and reuse the result across every page instead of re-issuing the same Paperless
// search on every 200-row page it loops (found reading this code before any importer existed
// to make the cost visible: a filtered "select all matching" over 2,000 ids meant ~10 identical
// searches against Paperless for the exact same query string).
async function resolvePaperlessIdFilter(
  organizationId: string,
  options: Pick<ListDocumentsOptions, "q" | "tag">
): Promise<Set<number> | null> {
  if (!options.q && !options.tag) return null;

  const client = await paperlessFor(organizationId);
  const params = new URLSearchParams({ page_size: String(MAX_PAPERLESS_ID_SET) });
  if (options.q) params.set("query", options.q);
  if (options.tag) params.set("tags__name__iexact", options.tag);

  const envelope = await client.get<{ results: { id: number }[] }>(
    `/api/documents/?${params.toString()}`
  );
  return new Set(envelope.results.map((r) => r.id));
}

// specs/05-level-1-structure.md §Tables and saved views: "A mixed query resolves Paperless-side
// first (returns ids), then intersects with our connection query, then hydrates." type/date are
// mirrored exactly for listing (documents.document_type_key/document_date), so they're served
// straight from our own DB rather than round-tripping to Paperless for values we already have —
// only `q`/`tag`, which we deliberately don't mirror, actually need the Paperless-first step.
//
// `precomputed.paperlessIds` lets listDocumentIds() hoist resolvePaperlessIdFilter() out of its
// own per-page loop instead of re-resolving it on every page.
export async function listDocuments(
  organizationId: string,
  options: ListDocumentsOptions = {},
  precomputed: { paperlessIds?: Set<number> | null } = {}
): Promise<{ items: Document[]; nextCursor: string | null }> {
  const limit = options.limit ?? DEFAULT_PAGE_SIZE;
  const db = await createClient();

  const paperlessIds =
    precomputed.paperlessIds !== undefined
      ? precomputed.paperlessIds
      : await resolvePaperlessIdFilter(organizationId, options);
  if (paperlessIds && paperlessIds.size === 0) return { items: [], nextCursor: null };

  // Contradictory by construction (a document "connected to entity X" necessarily has a
  // connection) — never issued as a query, just short-circuited.
  if (options.hasNoConnections && options.entityId) {
    return { items: [], nextCursor: null };
  }

  if (options.hasNoConnections) {
    return listDocumentsWithoutConnections(organizationId, options, limit, paperlessIds);
  }

  let entityConnectedDocIds: Set<string> | null = null;
  if (options.entityId) {
    const ctx: ServiceContext = { db, orgId: organizationId, actorId: null, correlationId: randomUUID() };
    // listConnectedIds(), not getConnections() — this only needs which documents are on the
    // other side, never the label/entity-type hydration getConnections() also does.
    const others = await listConnectedIds(ctx, "entity", options.entityId);
    entityConnectedDocIds = new Set(others.filter((o) => o.kind === "document").map((o) => o.id));
    if (entityConnectedDocIds.size === 0) return { items: [], nextCursor: null };
  }

  let query = db
    .from("documents")
    .select(LIST_DOCUMENT_COLUMNS)
    .eq("organization_id", organizationId)
    .is("deleted_at", null);

  if (options.documentTypeKey) query = query.eq("document_type_key", options.documentTypeKey);
  if (options.status) query = query.eq("status", options.status);
  if (options.dateFrom) query = query.gte("document_date", options.dateFrom);
  if (options.dateTo) query = query.lte("document_date", options.dateTo);
  if (paperlessIds) query = query.in("paperless_document_id", [...paperlessIds]);
  if (entityConnectedDocIds) query = query.in("id", [...entityConnectedDocIds]);

  const cursor = decodeCursor(options.cursor);
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
    );
  }

  query = query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  const { data, error } = await query;
  if (error) throw error;

  return paginate(data as Document[] | null, limit);
}

function paginate(
  data: Document[] | null,
  limit: number
): { items: Document[]; nextCursor: string | null } {
  const items = data ?? [];
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const last = page[page.length - 1];

  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null
  };
}

// "Documents with no connections" — specs/05's workhorse view, how a tenant works through an
// import backlog. Used to pull every connection row for the org into memory to build a
// `NOT IN (id, id, id, ...)` string — specs/10-nonfunctional.md's named anti-pattern, and the
// first thing a real import's own "review your unconnected documents" flow would have hit at
// scale. list_documents_without_connections() (supabase/migrations/
// 20260916140000_documents_query_perf.sql) does the whole filtered, paginated query in one
// indexed statement (NOT EXISTS against connections' existing partial indexes) instead.
async function listDocumentsWithoutConnections(
  organizationId: string,
  options: ListDocumentsOptions,
  limit: number,
  paperlessIds: Set<number> | null
): Promise<{ items: Document[]; nextCursor: string | null }> {
  const db = await createClient();
  const cursor = decodeCursor(options.cursor);

  const { data, error } = await db.rpc("list_documents_without_connections", {
    p_organization_id: organizationId,
    p_document_type_key: options.documentTypeKey ?? null,
    p_status: options.status ?? null,
    p_date_from: options.dateFrom ?? null,
    p_date_to: options.dateTo ?? null,
    p_paperless_ids: paperlessIds ? [...paperlessIds] : null,
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_limit: limit + 1
  });
  if (error) throw error;

  return paginate(data, limit);
}

// specs/05-level-1-structure.md §Bulk business actions/§Export: "select all matching filter"
// needs the full id set behind a filter, not one page of it. Loops listDocuments()'s own
// cursor rather than duplicating its filter-building — capped at the same
// MAX_PAPERLESS_ID_SET ceiling the spec calls out as the one place naive code won't scale.
export async function listDocumentIds(
  organizationId: string,
  options: Omit<ListDocumentsOptions, "cursor" | "limit"> = {},
  cap = BULK_ID_CAP
): Promise<string[]> {
  // Resolved once, not once per 200-row page — the q/tag Paperless search returns the same
  // result regardless of which page listDocuments() is building, so re-issuing it every
  // iteration was pure waste (found reading this loop before any importer existed to make a
  // multi-thousand-id "select all matching filter" scan visible).
  const paperlessIds = await resolvePaperlessIdFilter(organizationId, options);
  if (paperlessIds && paperlessIds.size === 0) return [];

  const ids: string[] = [];
  let cursor: string | null = null;
  const pageSize = 200;

  while (ids.length < cap) {
    const { items, nextCursor }: { items: Document[]; nextCursor: string | null } =
      await listDocuments(organizationId, { ...options, cursor, limit: pageSize }, { paperlessIds });
    ids.push(...items.map((d) => d.id));
    if (!nextCursor) break;
    cursor = nextCursor;
  }

  return ids.slice(0, cap);
}

export type DocumentDetails = Document & {
  connections: ConnectionWithOther[];
  paperless: { customFields: Array<{ field: number; value: unknown }> } | null;
  history: DocumentHistoryEntry[];
};

// specs/03-api.md GET /documents/:id — mirror row + connections + history + a best-effort
// Paperless read, all in one round of parallel fan-out off a single document-row fetch. This
// used to be two separate exported functions (getDocument + getDocumentHistory), each fetching
// the document row independently and running its own work sequentially after the caller's
// first `await` finished — on a remote Supabase Cloud DB, every one of those round trips is
// real, measurable latency (400-800ms each, measured), and stacking them sequentially is what
// made the page slow. Paperless failures (orphaned document, transient outage) degrade to
// `paperless: null`/a Paperless-less `history` rather than failing the whole page — specs/05
// wants graceful degradation, not a hard error, when the other side of a relationship is gone.
//
// Deliberately takes only `documentId`, not `organizationId` — the caller doesn't need to
// resolve an active org first (that was a whole extra ~400-600ms round trip on its own,
// measured). `documents_select_member`'s RLS policy already scopes this select to orgs the
// caller is a member of; a document belonging to an org they're not in simply doesn't come
// back, which is exactly the specs/03-api.md "404, never 403" behavior this needs anyway.
// organization_id for every downstream call (Paperless, connections) comes off the row itself.
export async function getDocument(documentId: string): Promise<DocumentDetails> {
  const db = await createClient();
  const { data: doc, error } = await db
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!doc) throw new NotFoundError("Document not found");

  const organizationId = doc.organization_id;
  const ctx: ServiceContext = { db, orgId: organizationId, actorId: null, correlationId: randomUUID() };

  const [connections, paperless, history] = await Promise.all([
    getConnections(ctx, "document", documentId),
    (async (): Promise<DocumentDetails["paperless"]> => {
      try {
        const client = await paperlessFor(organizationId);
        const paperlessDoc = await getPaperlessDocument(client, doc.paperless_document_id);
        return { customFields: paperlessDoc.custom_fields };
      } catch {
        return null;
      }
    })(),
    getDocumentHistory(documentId, { db, organizationId, paperlessDocumentId: doc.paperless_document_id })
  ]);

  return { ...doc, connections, paperless, history };
}

export type DocumentHistoryEntry =
  | {
      source: "paperless";
      id: number;
      timestamp: string;
      action: string;
      changes: Record<string, unknown>;
      actorUsername: string | null;
    }
  | {
      source: "business";
      id: string;
      timestamp: string;
      action: string;
      actorId: string | null;
      metadata: unknown;
    };

// specs/03-api.md GET /documents/:id/history — merged Paperless document history + our own
// business audit_logs, per specs/02-data-model.md's explicit "never duplicate Paperless's
// document history; the document detail UI shows both, fetched from their respective sources."
// `getDocument()` already has the document row (organization_id + paperless_document_id) and a
// client by the time it needs history, so it passes both through to skip a second, redundant
// row fetch. A standalone caller only needs `documentId` — same RLS-scoped, no-pre-resolved-org
// pattern as `getDocument()` itself.
export async function getDocumentHistory(
  documentId: string,
  options: {
    db?: Awaited<ReturnType<typeof createClient>>;
    organizationId?: string;
    paperlessDocumentId?: number;
  } = {}
): Promise<DocumentHistoryEntry[]> {
  const db = options.db ?? (await createClient());
  let organizationId = options.organizationId;
  let paperlessDocumentId = options.paperlessDocumentId;

  if (organizationId === undefined || paperlessDocumentId === undefined) {
    const { data: doc, error } = await db
      .from("documents")
      .select("organization_id, paperless_document_id")
      .eq("id", documentId)
      .maybeSingle();

    if (error) throw error;
    if (!doc) throw new NotFoundError("Document not found");
    organizationId = doc.organization_id;
    paperlessDocumentId = doc.paperless_document_id;
  }

  const [paperlessEntries, businessEntries] = await Promise.all([
    (async (): Promise<DocumentHistoryEntry[]> => {
      try {
        const client = await paperlessFor(organizationId);
        const history = await getPaperlessDocumentHistory(client, paperlessDocumentId);
        return history.map((entry) => ({
          source: "paperless" as const,
          id: entry.id,
          timestamp: entry.timestamp,
          action: entry.action,
          changes: entry.changes,
          actorUsername: entry.actor?.username ?? null
        }));
      } catch {
        return [];
      }
    })(),
    (async (): Promise<DocumentHistoryEntry[]> => {
      const { data: rows, error: auditError } = await db
        .from("audit_logs")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("entity_type", "document")
        .eq("entity_id", documentId)
        .order("created_at", { ascending: false });

      if (auditError) throw auditError;

      return (rows ?? []).map((row) => ({
        source: "business" as const,
        id: row.id,
        timestamp: row.created_at,
        action: row.action,
        actorId: row.actor_id,
        metadata: row.metadata
      }));
    })()
  ]);

  return [...paperlessEntries, ...businessEntries].sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp)
  );
}

// specs/03-api.md PATCH /documents/:id. Written through to Paperless in the same operation,
// never mirror-only (specs/02-data-model.md: "Paperless wins on conflict... never write a
// mirrored field in our DB without also writing it through to Paperless"). The `documents`
// table has no update RLS policy at all (only the sync worker writes it, per its own design —
// docs/DATABASE.md) — the admin client does the mirror write here, so the write-access check
// RLS would otherwise provide has to be done explicitly in application code first.
export async function updateDocument(
  userId: string,
  organizationId: string,
  documentId: string,
  input: {
    title?: string;
    documentDate?: string;
    documentTypeId?: number | null;
    customFieldValues?: Array<{ field: number; value: unknown }>;
  }
): Promise<Document> {
  const db = await createClient();
  const { data: doc, error } = await db
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!doc) throw new NotFoundError("Document not found");

  const membership = await getMembership(organizationId, userId);
  if (!membership || membership.role === "read-only") {
    throw new AuthorizationError("You do not have write access to this organization");
  }

  const patch: Parameters<typeof updatePaperlessDocument>[2] = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.documentDate !== undefined) patch.created = input.documentDate;
  if (input.documentTypeId !== undefined) patch.document_type = input.documentTypeId;
  if (input.customFieldValues !== undefined) patch.custom_fields = input.customFieldValues;

  if (Object.keys(patch).length === 0) return doc;

  const client = await paperlessFor(organizationId);
  const updated = await updatePaperlessDocument(client, doc.paperless_document_id, patch);

  const mirrorUpdate: Database["public"]["Tables"]["documents"]["Update"] = {};
  if (input.title !== undefined) mirrorUpdate.title = updated.title;
  if (input.documentDate !== undefined) {
    mirrorUpdate.document_date = updated.created ? updated.created.slice(0, 10) : null;
  }
  if (input.documentTypeId !== undefined) {
    mirrorUpdate.document_type_key = updated.document_type
      ? toDocumentTypeKey(await getPaperlessDocumentTypeName(client, updated.document_type))
      : null;
  }

  let updatedRow = doc;
  if (Object.keys(mirrorUpdate).length > 0) {
    const admin = createAdminClient();
    const { data, error: updateError } = await admin
      .from("documents")
      .update(mirrorUpdate)
      .eq("id", documentId)
      .eq("organization_id", organizationId)
      .select("*")
      .single();

    if (updateError) throw updateError;
    updatedRow = data;
  }

  await logEvent({
    actorId: userId,
    action: "document.updated",
    entityType: "document",
    entityId: documentId,
    organizationId,
    metadata: { fields: Object.keys(input) }
  });

  return updatedRow;
}

// Surfaces the upload pipeline's in-flight/failed state (validating, submitting, processing,
// failed) that has no row in `documents` yet — without this, an upload sits invisible between
// "upload-complete returned" and "sync-paperless-document.ts finishes."
export async function listRecentUploads(organizationId: string): Promise<DocumentUpload[]> {
  const db = await createClient();
  const { data, error } = await db
    .from("document_uploads")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(RECENT_LIST_LIMIT);

  if (error) throw error;
  return data;
}
