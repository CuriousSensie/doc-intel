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
import { getConnections, type ConnectionWithOther } from "@/modules/connections/connections.service";
import { getMembership } from "@/modules/organizations/organizations.service";
import type { Database } from "@/types/database";

export type DocumentUpload = Database["public"]["Tables"]["document_uploads"]["Row"];
export type Document = Database["public"]["Tables"]["documents"]["Row"];

const RECENT_LIST_LIMIT = 50;
const DEFAULT_PAGE_SIZE = 25;
// specs/05-level-1-structure.md: "Cap the Paperless id set and paginate carefully — this is the
// one place where naive implementation will not scale past a few thousand documents."
const MAX_PAPERLESS_ID_SET = 2000;

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

  await enqueue(QUEUE_NAMES.validateUpload, {
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

// specs/05-level-1-structure.md §Tables and saved views: "A mixed query resolves Paperless-side
// first (returns ids), then intersects with our connection query, then hydrates." type/date are
// mirrored exactly for listing (documents.document_type_key/document_date), so they're served
// straight from our own DB rather than round-tripping to Paperless for values we already have —
// only `q`/`tag`, which we deliberately don't mirror, actually need the Paperless-first step.
export async function listDocuments(
  organizationId: string,
  options: ListDocumentsOptions = {}
): Promise<{ items: Document[]; nextCursor: string | null }> {
  const limit = options.limit ?? DEFAULT_PAGE_SIZE;
  const db = await createClient();

  let paperlessIds: Set<number> | null = null;
  if (options.q || options.tag) {
    const client = await paperlessFor(organizationId);
    const params = new URLSearchParams({ page_size: String(MAX_PAPERLESS_ID_SET) });
    if (options.q) params.set("query", options.q);
    if (options.tag) params.set("tags__name__iexact", options.tag);

    const envelope = await client.get<{ results: { id: number }[] }>(
      `/api/documents/?${params.toString()}`
    );
    paperlessIds = new Set(envelope.results.map((r) => r.id));
    if (paperlessIds.size === 0) return { items: [], nextCursor: null };
  }

  let entityConnectedDocIds: Set<string> | null = null;
  if (options.entityId) {
    const ctx: ServiceContext = { db, orgId: organizationId, actorId: null, correlationId: randomUUID() };
    const connections = await getConnections(ctx, "entity", options.entityId);
    entityConnectedDocIds = new Set(
      connections.filter((c) => c.other.kind === "document").map((c) => c.other.id)
    );
    if (entityConnectedDocIds.size === 0) return { items: [], nextCursor: null };
  }

  let query = db
    .from("documents")
    .select("*")
    .eq("organization_id", organizationId)
    .is("deleted_at", null);

  if (options.documentTypeKey) query = query.eq("document_type_key", options.documentTypeKey);
  if (options.status) query = query.eq("status", options.status);
  if (options.dateFrom) query = query.gte("document_date", options.dateFrom);
  if (options.dateTo) query = query.lte("document_date", options.dateTo);
  if (paperlessIds) query = query.in("paperless_document_id", [...paperlessIds]);
  if (entityConnectedDocIds) query = query.in("id", [...entityConnectedDocIds]);

  if (options.hasNoConnections) {
    // "Documents with no connections" — specs/05's workhorse view, how a tenant works through
    // an import backlog. No FK on connections.source_id/target_id (polymorphic by design), so
    // this resolves the excluded-id set in application code rather than a subquery join.
    const { data: connectionRows, error: connError } = await db
      .from("connections")
      .select("source_kind, source_id, target_kind, target_id")
      .eq("organization_id", organizationId)
      .is("deleted_at", null);

    if (connError) throw connError;

    const connectedDocIds = new Set<string>();
    for (const row of connectionRows ?? []) {
      if (row.source_kind === "document") connectedDocIds.add(row.source_id);
      if (row.target_kind === "document") connectedDocIds.add(row.target_id);
    }
    if (connectedDocIds.size > 0) {
      query = query.not("id", "in", `(${[...connectedDocIds].join(",")})`);
    }
  }

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

  const items = data ?? [];
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const last = page[page.length - 1];

  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null
  };
}

export type DocumentDetails = Document & {
  connections: ConnectionWithOther[];
  paperless: { customFields: Array<{ field: number; value: unknown }> } | null;
};

// specs/03-api.md GET /documents/:id — mirror row + connections + a best-effort Paperless read.
// A Paperless failure (orphaned document, transient outage) degrades to `paperless: null` rather
// than failing the whole page — the mirror-backed metadata and connections are still useful on
// their own, and specs/05 explicitly wants "connected entity was deleted"-style graceful
// degradation, not a hard error, when the other side of a relationship is gone.
export async function getDocument(organizationId: string, documentId: string): Promise<DocumentDetails> {
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

  const ctx: ServiceContext = { db, orgId: organizationId, actorId: null, correlationId: randomUUID() };
  const connections = await getConnections(ctx, "document", documentId);

  let paperless: DocumentDetails["paperless"] = null;
  try {
    const client = await paperlessFor(organizationId);
    const paperlessDoc = await getPaperlessDocument(client, doc.paperless_document_id);
    paperless = { customFields: paperlessDoc.custom_fields };
  } catch {
    paperless = null;
  }

  return { ...doc, connections, paperless };
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
export async function getDocumentHistory(
  organizationId: string,
  documentId: string
): Promise<DocumentHistoryEntry[]> {
  const db = await createClient();
  const { data: doc, error } = await db
    .from("documents")
    .select("id, paperless_document_id")
    .eq("id", documentId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw error;
  if (!doc) throw new NotFoundError("Document not found");

  const [paperlessEntries, businessEntries] = await Promise.all([
    (async (): Promise<DocumentHistoryEntry[]> => {
      try {
        const client = await paperlessFor(organizationId);
        const history = await getPaperlessDocumentHistory(client, doc.paperless_document_id);
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
