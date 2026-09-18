import { randomUUID } from "node:crypto";

import { documentsConfig } from "@/config/documents";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/errors";
import { logEvent } from "@/lib/events";
import {
  deletePaperlessDocument,
  getPaperlessCorrespondentName,
  getPaperlessDocument,
  getPaperlessDocumentHistory,
  getPaperlessDocumentTypeName,
  toDocumentTypeKey,
  updatePaperlessDocument
} from "@/lib/paperless/documents";
import { paperlessFor } from "@/lib/paperless/client";
import type { PaperlessListEnvelope } from "@/lib/paperless/types";
import { getRedisClient } from "@/lib/redis";
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
import { listCustomFieldDefs } from "@/modules/custom-fields/custom-field-defs.service";
import type { Database } from "@/types/database";

export type DocumentUpload = Database["public"]["Tables"]["document_uploads"]["Row"];
export type Document = Database["public"]["Tables"]["documents"]["Row"];

const RECENT_LIST_LIMIT = 50;
const DEFAULT_PAGE_SIZE = 25;
export const DOCUMENT_PAGE_SIZES = [10, 25, 50] as const;
export type DocumentPageSize = (typeof DOCUMENT_PAGE_SIZES)[number];
const PAPERLESS_FILTER_CACHE_TTL_SECONDS = 60;
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

export type DocumentSort = "created" | "title" | "mimeType" | "size" | "pages";
export type DocumentSortDirection = "asc" | "desc";

export type ListDocumentsOptions = {
  documentTypeKey?: string;
  dateFrom?: string; // yyyy-mm-dd
  dateTo?: string;
  status?: Document["status"];
  // Not mirrored locally (no second search engine, per specs/00's non-goals) — always
  // Paperless-delegated. Tags/correspondent aren't mirrored either (only correspondent_name/
  // document_type_key text are, for display only), so they're delegated too.
  q?: string;
  // Search mode for `q`: full text (title + content, Paperless's default `query=`) or
  // title-only (`title__icontains=`). Ignored when `q` is unset.
  titleOnly?: boolean;
  tagIds?: number[];
  correspondentId?: number;
  // Business filters — served entirely from our own DB, never sent to Paperless.
  entityId?: string;
  hasNoConnections?: boolean;
  sort?: DocumentSort;
  sortDirection?: DocumentSortDirection;
  page?: number;
  pageSize?: DocumentPageSize;
  cursor?: string | null;
  limit?: number;
};

export type ListDocumentsResult = {
  items: Document[];
  totalCount: number;
  page: number;
  pageSize: DocumentPageSize;
  totalPages: number;
  nextCursor: string | null;
};

const LIST_DOCUMENT_COLUMNS =
  "id, organization_id, paperless_document_id, title, document_type_key, document_date, correspondent_name, page_count, byte_size, mime_type, checksum, status, source, import_job_id, synced_at, created_by, created_at, updated_at, deleted_at" as const;

const SORT_COLUMNS: Record<DocumentSort, string> = {
  created: "created_at",
  title: "title",
  mimeType: "mime_type",
  size: "byte_size",
  pages: "page_count"
};
const NULLABLE_SORTS = new Set<DocumentSort>(["mimeType", "size", "pages"]);

function nextUtcDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString();
}

// Resolves the `q`/`tagIds`/`correspondentId` Paperless-first id set as a single combined
// request — factored out so listDocumentIds() can call it once and reuse the result across
// every page instead of re-issuing the same Paperless search on every 200-row page it loops
// (found reading this code before any importer existed to make the cost visible: a filtered
// "select all matching" over 2,000 ids meant ~10 identical searches against Paperless for the
// exact same query string).
async function resolvePaperlessIdFilter(
  organizationId: string,
  options: Pick<ListDocumentsOptions, "q" | "titleOnly" | "tagIds" | "correspondentId">
): Promise<Set<number> | null> {
  if (!options.q && !options.tagIds?.length && !options.correspondentId) return null;

  const normalized = {
    q: options.q?.trim() || null,
    titleOnly: Boolean(options.titleOnly),
    tagIds: [...(options.tagIds ?? [])].sort((a, b) => a - b),
    correspondentId: options.correspondentId ?? null
  };
  const cacheKey = `paperless:documents:filter-ids:v1:${organizationId}:${JSON.stringify(
    normalized
  )}`;
  const redis = getRedisClient();
  const cached = await redis.get(cacheKey);
  if (cached !== null) return new Set(JSON.parse(cached) as number[]);

  const client = await paperlessFor(organizationId);
  const params = new URLSearchParams({ page_size: String(MAX_PAPERLESS_ID_SET) });
  if (normalized.q) {
    if (normalized.titleOnly) params.set("title__icontains", normalized.q);
    else params.set("query", normalized.q);
  }
  if (normalized.tagIds.length) params.set("tags__id__in", normalized.tagIds.join(","));
  if (normalized.correspondentId) {
    params.set("correspondent__id__in", String(normalized.correspondentId));
  }

  const ids: number[] = [];
  let path: string | null = `/api/documents/?${params.toString()}`;
  while (path) {
    const envelope: PaperlessListEnvelope<{ id: number }> = await client.get(path);
    ids.push(...envelope.results.map((r) => r.id));
    path = envelope.next ? toPaperlessRequestPath(envelope.next) : null;
  }

  await redis.set(cacheKey, JSON.stringify(ids), "EX", PAPERLESS_FILTER_CACHE_TTL_SECONDS);
  return new Set(ids);
}

function toPaperlessRequestPath(absoluteUrl: string): string {
  const parsed = new URL(absoluteUrl);
  return `${parsed.pathname}${parsed.search}`;
}

// Local to documents.service.ts rather than a change to the shared `{createdAt, id}` cursor in
// src/lib/pagination.ts — five other modules (admin, entities, notifications) depend on that
// exact shape, and only documents needs a cursor that can carry any of three different sort
// columns. `sortValue` is always the current sort column's own value (a string for
// title/mime_type, an ISO timestamp for created_at, or a stringified number for numeric sorts).
type DocumentCursor = { sortValue: string; id: string };

function encodeDocumentCursor(cursor: DocumentCursor): string {
  return Buffer.from(`${cursor.sortValue}|${cursor.id}`, "utf8").toString("base64url");
}

function decodeDocumentCursor(value: string | null | undefined): DocumentCursor | null {
  if (!value) return null;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const [sortValue, id] = decoded.split("|");
    if (sortValue === undefined || !id) return null;
    return { sortValue, id };
  } catch {
    return null;
  }
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
): Promise<ListDocumentsResult> {
  const isCursorMode = Boolean(options.cursor || options.limit);
  const pageSize = normalizePageSize(options.pageSize);
  const limit = isCursorMode ? normalizeLimit(options.limit) : pageSize;
  const sort = options.sort ?? "created";
  const sortColumn = SORT_COLUMNS[sort];
  const ascending = options.sortDirection === "asc";
  const db = await createClient();

  const paperlessIds =
    precomputed.paperlessIds !== undefined
      ? precomputed.paperlessIds
      : await resolvePaperlessIdFilter(organizationId, options);
  if (paperlessIds && paperlessIds.size === 0) {
    return emptyDocumentsResult(options.page, pageSize);
  }

  // Contradictory by construction (a document "connected to entity X" necessarily has a
  // connection) — never issued as a query, just short-circuited.
  if (options.hasNoConnections && options.entityId) {
    return emptyDocumentsResult(options.page, pageSize);
  }

  if (options.hasNoConnections) {
    return listDocumentsWithoutConnections(organizationId, options, pageSize, limit, paperlessIds);
  }

  let entityConnectedDocIds: Set<string> | null = null;
  if (options.entityId) {
    const ctx: ServiceContext = {
      db,
      orgId: organizationId,
      actorId: null,
      correlationId: randomUUID()
    };
    // listConnectedIds(), not getConnections() — this only needs which documents are on the
    // other side, never the label/entity-type hydration getConnections() also does.
    const others = await listConnectedIds(ctx, "entity", options.entityId);
    entityConnectedDocIds = new Set(others.filter((o) => o.kind === "document").map((o) => o.id));
    if (entityConnectedDocIds.size === 0) return emptyDocumentsResult(options.page, pageSize);
  }

  let query = db
    .from("documents")
    .select(LIST_DOCUMENT_COLUMNS, options.cursor || options.limit ? undefined : { count: "exact" })
    .eq("organization_id", organizationId)
    .is("deleted_at", null);

  if (options.documentTypeKey) query = query.eq("document_type_key", options.documentTypeKey);
  if (options.status) query = query.eq("status", options.status);
  if (options.dateFrom) query = query.gte("created_at", `${options.dateFrom}T00:00:00.000Z`);
  if (options.dateTo) query = query.lt("created_at", nextUtcDate(options.dateTo));
  if (paperlessIds) query = query.in("paperless_document_id", [...paperlessIds]);
  if (entityConnectedDocIds) query = query.in("id", [...entityConnectedDocIds]);

  const cursor = decodeDocumentCursor(options.cursor);
  if (cursor) {
    const op = ascending ? "gt" : "lt";
    query = query.or(
      `${sortColumn}.${op}.${cursor.sortValue},and(${sortColumn}.eq.${cursor.sortValue},id.${op}.${cursor.id})`
    );
  }

  query = query
    .order(sortColumn, NULLABLE_SORTS.has(sort) ? { ascending, nullsFirst: false } : { ascending })
    .order("id", { ascending });

  if (isCursorMode) {
    query = query.limit(limit + 1);
  } else {
    const page = normalizePage(options.page);
    const offset = (page - 1) * pageSize;
    query = query.range(offset, offset + pageSize - 1);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  if (isCursorMode) {
    return paginateCursor(data as Document[] | null, limit, sortColumn);
  }

  return paginateNumbered(data as Document[] | null, count ?? 0, options.page, pageSize);
}

function normalizePage(value: number | undefined): number {
  return Number.isInteger(value) && value && value > 0 ? value : 1;
}

function normalizePageSize(value: number | undefined): DocumentPageSize {
  return DOCUMENT_PAGE_SIZES.includes(value as DocumentPageSize)
    ? (value as DocumentPageSize)
    : DEFAULT_PAGE_SIZE;
}

function normalizeLimit(value: number | undefined): number {
  return Number.isInteger(value) && value && value > 0
    ? Math.min(value, MAX_PAPERLESS_ID_SET)
    : DEFAULT_PAGE_SIZE;
}

function emptyDocumentsResult(
  requestedPage: number | undefined,
  pageSize: DocumentPageSize
): ListDocumentsResult {
  return {
    items: [],
    totalCount: 0,
    page: normalizePage(requestedPage),
    pageSize,
    totalPages: 0,
    nextCursor: null
  };
}

function paginateNumbered(
  data: Document[] | null,
  totalCount: number,
  requestedPage: number | undefined,
  pageSize: DocumentPageSize
): ListDocumentsResult {
  return {
    items: data ?? [],
    totalCount,
    page: normalizePage(requestedPage),
    pageSize,
    totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize),
    nextCursor: null
  };
}

function paginateCursor(
  data: Document[] | null,
  limit: number,
  sortColumn: string
): ListDocumentsResult {
  const items = data ?? [];
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const last = page[page.length - 1];

  return {
    items: page,
    totalCount: page.length,
    page: 1,
    pageSize: normalizePageSize(limit),
    totalPages: hasMore ? 2 : page.length > 0 ? 1 : 0,
    nextCursor:
      hasMore && last
        ? encodeDocumentCursor({
            sortValue: String((last as unknown as Record<string, unknown>)[sortColumn] ?? ""),
            id: last.id
          })
        : null
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
  pageSize: DocumentPageSize,
  limit: number,
  paperlessIds: Set<number> | null
): Promise<ListDocumentsResult> {
  const db = await createClient();
  const cursor = decodeDocumentCursor(options.cursor);
  const isCursorMode = Boolean(options.cursor || options.limit);

  if (!isCursorMode) {
    const page = normalizePage(options.page);
    const offset = (page - 1) * pageSize;
    const rpcArgs = {
      p_organization_id: organizationId,
      p_document_type_key: options.documentTypeKey ?? null,
      p_status: options.status ?? null,
      p_date_from: options.dateFrom ?? null,
      p_date_to: options.dateTo ?? null,
      p_paperless_ids: paperlessIds ? [...paperlessIds] : null
    };

    const [itemsResult, countResult] = await Promise.all([
      db.rpc("list_documents_without_connections_page", {
        ...rpcArgs,
        p_sort: options.sort ?? "created",
        p_sort_direction: options.sortDirection ?? "desc",
        p_offset: offset,
        p_limit: pageSize
      }),
      db.rpc("count_documents_without_connections", rpcArgs)
    ]);

    if (itemsResult.error) throw itemsResult.error;
    if (countResult.error) throw countResult.error;

    return paginateNumbered(
      (itemsResult.data ?? []) as Document[],
      Number(countResult.data ?? 0),
      options.page,
      pageSize
    );
  }

  const { data, error } = await db.rpc("list_documents_without_connections", {
    p_organization_id: organizationId,
    p_document_type_key: options.documentTypeKey ?? null,
    p_status: options.status ?? null,
    p_date_from: options.dateFrom ?? null,
    p_date_to: options.dateTo ?? null,
    p_paperless_ids: paperlessIds ? [...paperlessIds] : null,
    p_cursor_created_at: cursor?.sortValue ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_limit: limit + 1
  });
  if (error) throw error;

  return paginateCursor(data, limit, "created_at");
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
    const { items, nextCursor } = await listDocuments(
      organizationId,
      { ...options, cursor, limit: pageSize },
      { paperlessIds }
    );
    ids.push(...items.map((d) => d.id));
    if (!nextCursor) break;
    cursor = nextCursor;
  }

  return ids.slice(0, cap);
}

export async function countConnectionsForDocuments(
  organizationId: string,
  documentIds: string[]
): Promise<Record<string, number>> {
  if (documentIds.length === 0) return {};

  const db = await createClient();
  const { data, error } = await db.rpc("count_document_connections", {
    p_organization_id: organizationId,
    p_document_ids: documentIds
  });
  if (error) throw error;

  const counts: Record<string, number> = Object.fromEntries(documentIds.map((id) => [id, 0]));
  for (const row of data ?? []) counts[row.document_id] = Number(row.connection_count);
  return counts;
}

export type DocumentDetails = Document & {
  connections: ConnectionWithOther[];
  paperless: {
    customFields: Array<{ field: number; value: unknown }>;
    content: string;
    tagIds: number[];
    originalFileName: string;
  } | null;
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
  const ctx: ServiceContext = {
    db,
    orgId: organizationId,
    actorId: null,
    correlationId: randomUUID()
  };

  const [connections, paperless, history, resolvedByteSize] = await Promise.all([
    getConnections(ctx, "document", documentId),
    (async (): Promise<DocumentDetails["paperless"]> => {
      try {
        const client = await paperlessFor(organizationId);
        const paperlessDoc = await getPaperlessDocument(client, doc.paperless_document_id);
        return {
          customFields: paperlessDoc.custom_fields,
          content: paperlessDoc.content,
          tagIds: paperlessDoc.tags,
          originalFileName: paperlessDoc.original_file_name
        };
      } catch {
        return null;
      }
    })(),
    getDocumentHistory(documentId, {
      db,
      organizationId,
      paperlessDocumentId: doc.paperless_document_id
    }),
    // byte_size is only ever populated on the direct-upload path (sync-paperless-document.ts's
    // own comment — Paperless's document API has no such field at all). Anything synced another
    // way (webhook, reconciliation, import) shows "—" forever otherwise, which is what "file
    // size is not shown" turned out to mean. A live HEAD request is cheap (no body on the wire,
    // confirmed live) and never persisted — display-only, not a second source of truth.
    doc.byte_size === null
      ? (async () => {
          try {
            const client = await paperlessFor(organizationId);
            return await client.headContentLength(
              `/api/documents/${doc.paperless_document_id}/download/`
            );
          } catch {
            return null;
          }
        })()
      : Promise.resolve(doc.byte_size)
  ]);

  return { ...doc, byte_size: resolvedByteSize, connections, paperless, history };
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

  const [paperlessEntries, businessEntries, connectionEntries] = await Promise.all([
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
    })(),
    // Connection create/delete events are logged with entity_type='connection' and the
    // connection's own row id (connections.service.ts), never entity_type='document' — a
    // document's own history needs a separate lookup by the document id appearing as either
    // side of the connection in the event's metadata. Known gap: the >50-item async bulk-connect
    // path logs one aggregate event with only the target entity's id, not each document's id, so
    // a document connected that way won't show the event here — see bulkCreateConnections's own
    // logEvent call.
    (async (): Promise<DocumentHistoryEntry[]> => {
      const { data: rows, error: auditError } = await db
        .from("audit_logs")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("entity_type", "connection")
        .or(`metadata->>source_id.eq.${documentId},metadata->>target_id.eq.${documentId}`)
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

  return [...paperlessEntries, ...businessEntries, ...connectionEntries].sort((a, b) =>
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
    correspondentId?: number | null;
    tagIds?: number[];
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
  if (input.correspondentId !== undefined) patch.correspondent = input.correspondentId;
  if (input.tagIds !== undefined) patch.tags = input.tagIds;
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
  if (input.correspondentId !== undefined) {
    mirrorUpdate.correspondent_name = updated.correspondent
      ? await getPaperlessCorrespondentName(client, updated.correspondent)
      : null;
  }
  // tagIds isn't mirrored (documents has no tags column, per specs/02 — tags stay
  // Paperless-only), so a tags-only patch never populates mirrorUpdate below and correctly
  // skips the mirror write entirely.

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

  // specs/07-rules-engine.md: "user edits win over rules always." The spec's own suggested
  // fallback — check Paperless document history for a human edit — turns out not to work in
  // this architecture: every write for a tenant, whether triggered by a human through this app
  // or by a rule running in the worker, goes through the same single tenant service user
  // (paperlessFor(orgId)), so Paperless's own history `actor` field can never tell those two
  // apart (confirmed live against the pinned instance this session — every edit through this
  // codebase shows up as the same Paperless user regardless of who or what triggered it). The
  // only place that actually knows "a human just edited this field" is this function itself, so
  // it writes field_provenance directly instead of relying on a Paperless-side signal.
  const admin = createAdminClient();
  const provenanceFieldKeys: string[] = [];
  if (input.documentTypeId !== undefined) provenanceFieldKeys.push("document.type");
  if (input.correspondentId !== undefined) provenanceFieldKeys.push("document.correspondent");
  if (input.customFieldValues !== undefined) {
    const defsCtx: ServiceContext = { db: admin, orgId: organizationId, actorId: userId, correlationId: randomUUID() };
    const defs = await listCustomFieldDefs(defsCtx);
    const keyByPaperlessFieldId = new Map(
      defs.filter((d) => d.paperless_custom_field_id !== null).map((d) => [d.paperless_custom_field_id, d.key])
    );
    for (const cfv of input.customFieldValues) {
      const key = keyByPaperlessFieldId.get(cfv.field);
      if (key) provenanceFieldKeys.push(`document.custom.${key}`);
    }
  }

  if (provenanceFieldKeys.length > 0) {
    const { error: provenanceError } = await admin.from("field_provenance").upsert(
      provenanceFieldKeys.map((fieldKey) => ({
        organization_id: organizationId,
        document_id: documentId,
        field_key: fieldKey,
        updated_by: "user" as const,
        source_id: userId,
        updated_at: new Date().toISOString()
      })),
      { onConflict: "document_id,field_key" }
    );
    if (provenanceError) throw provenanceError;
  }

  await logEvent({
    actorId: userId,
    action: "document.updated",
    entityType: "document",
    entityId: documentId,
    organizationId,
    metadata: { fields: Object.keys(input) }
  });

  // Real gap found via live testing: the rules engine's document.updated trigger only ever
  // fired from sync-paperless-document.ts (webhook/reconciliation noticing a type/date change
  // coming from Paperless), never from this function — the one path a user actually associates
  // with "I edited a document." A rule configured on document.updated never ran for an edit made
  // through this app's own edit form, regardless of what changed. field_provenance above already
  // protects any field the user just touched from being overwritten by the fired rule (user-edit-
  // wins), so firing on every successful patch here — not just type/date — is safe: a rule can
  // still act on other conditions/fields this edit didn't touch.
  await enqueue(QUEUE_NAMES.runRule, { orgId: organizationId, documentId, trigger: "document.updated" });

  return updatedRow;
}

// specs/03-api.md DELETE /documents/:id: "Soft-delete locally, delete in Paperless, cascade-mark
// connections." The mark itself needs no extra write — getConnections() already treats a
// document with deleted_at set as `isDeleted: true` on whichever side it's viewed from (same
// mechanism specs/05 describes for a deleted entity), so a plain soft-delete here is sufficient.
export async function deleteDocument(
  userId: string,
  organizationId: string,
  documentId: string
): Promise<void> {
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

  const client = await paperlessFor(organizationId);
  await deletePaperlessDocument(client, doc.paperless_document_id);

  const admin = createAdminClient();
  const { error: updateError } = await admin
    .from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("organization_id", organizationId);

  if (updateError) throw updateError;

  await logEvent({
    actorId: userId,
    action: "document.deleted",
    entityType: "document",
    entityId: documentId,
    organizationId,
    metadata: { title: doc.title }
  });
}

// Lightweight sibling to getDocument() for callers that only need the mirror row itself (e.g.
// next/previous navigation's sort-column values) — skips the connections/Paperless/history
// fan-out getDocument() does for the full detail page render.
export async function getDocumentRow(documentId: string): Promise<Document> {
  const db = await createClient();
  const { data: doc, error } = await db
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!doc) throw new NotFoundError("Document not found");
  return doc;
}

// Paperless-ngx-style "next document"/"previous document" navigation, scoped to whatever
// filter+sort the caller arrived from (the document list page passes its current querystring
// through as `ctx` on each row link — see documents-filter-bar.tsx). Reuses listDocuments()'s
// own sort-column mapping and keyset comparison rather than a second implementation: a "next"
// row is exactly what a one-row page starting right after the current document's own cursor
// would return, in the same sort order; "previous" is the same query with the order reversed.
export async function getAdjacentDocumentId(
  organizationId: string,
  current: Document,
  options: ListDocumentsOptions,
  direction: "next" | "previous"
): Promise<string | null> {
  const sort = options.sort ?? "created";
  const sortColumn = SORT_COLUMNS[sort];
  const baseAscending = options.sortDirection === "asc";
  // "next" walks the list in its own displayed order; "previous" walks it backwards — so
  // "previous" always queries with the opposite ascending/descending flag from the list's own.
  const queryAscending = direction === "next" ? baseAscending : !baseAscending;

  const sortValue = String((current as unknown as Record<string, unknown>)[sortColumn] ?? "");
  const cursor = encodeDocumentCursor({ sortValue, id: current.id });

  const { items } = await listDocuments(organizationId, {
    ...options,
    sort,
    sortDirection: queryAscending ? "asc" : "desc",
    cursor,
    limit: 1
  });

  return items[0]?.id ?? null;
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
