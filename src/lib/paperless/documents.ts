import type { OwnedObjectPermissions, PaperlessClient } from "./client";
import type {
  PaperlessCustomField,
  PaperlessCustomFieldSelectOption,
  PaperlessDocument,
  PaperlessDocumentHistoryEntry,
  PaperlessListEnvelope
} from "./types";

export function getPaperlessDocument(
  client: PaperlessClient,
  paperlessDocumentId: number
): Promise<PaperlessDocument> {
  return client.get<PaperlessDocument>(`/api/documents/${paperlessDocumentId}/`);
}

// specs/03-api.md's PATCH /documents/:id — title/date/type/custom-field writes always go
// through here, never mirror-only (specs/02-data-model.md: "Paperless wins on conflict", we
// never write a mirrored field in our DB without also writing it through to Paperless in the
// same operation). Returns Paperless's own post-write representation so the caller mirrors
// exactly what Paperless actually stored, not what was requested.
export function updatePaperlessDocument(
  client: PaperlessClient,
  paperlessDocumentId: number,
  patch: {
    title?: string;
    created?: string;
    document_type?: number | null;
    tags?: number[];
    custom_fields?: Array<{ field: number; value: unknown }>;
  }
): Promise<PaperlessDocument> {
  return client.patch<PaperlessDocument>(`/api/documents/${paperlessDocumentId}/`, patch);
}

// specs/03-api.md DELETE /documents/:id — soft-delete locally, delete in Paperless.
export function deletePaperlessDocument(
  client: PaperlessClient,
  paperlessDocumentId: number
): Promise<void> {
  return client.delete(`/api/documents/${paperlessDocumentId}/`);
}

// specs/12-agent-rules.md rule 4: never create a Paperless object without explicit owner/group
// permissions — same createOwnedObject() path provision-tenant.ts already uses for document
// types/storage paths, now reused for the document detail page's inline "create tag/document
// type" pickers. Paperless itself enforces name uniqueness per model; a duplicate name surfaces
// as a normal mapped Paperless error, not something checked here.
// `color` accepted on create, confirmed live (2026-09-16) — Paperless derives `text_color`
// itself from the contrast, never sent by us.
export function createPaperlessTag(
  client: PaperlessClient,
  name: string,
  ownership: OwnedObjectPermissions,
  color?: string,
  matching?: PaperlessMatchingFields
): Promise<PaperlessTag> {
  return client.createOwnedObject(
    "/api/tags/",
    { name, ...(color ? { color } : {}), ...matching },
    ownership
  );
}

export function createPaperlessDocumentType(
  client: PaperlessClient,
  name: string,
  ownership: OwnedObjectPermissions,
  matching?: PaperlessMatchingFields
): Promise<PaperlessDocumentType> {
  return client.createOwnedObject("/api/document_types/", { name, ...matching }, ownership);
}

// specs/05-level-1-structure.md §Bulk business actions: "Paperless's [bulk actions]: change
// document type, tags, custom field values, reprocess, delete — proxied to
// Paperless bulk_edit, not reimplemented." Paperless applies these atomically server-side
// (its own task queue), so this is a single synchronous proxy call, not a worker job.
export function bulkEditPaperlessDocuments(
  client: PaperlessClient,
  input: {
    documentIds: number[];
    method: "set_document_type" | "add_tag" | "remove_tag" | "modify_custom_fields" | "delete" | "reprocess";
    parameters?: Record<string, unknown>;
  }
): Promise<{ result: string }> {
  return client.post<{ result: string }>("/api/documents/bulk_edit/", {
    documents: input.documentIds,
    method: input.method,
    parameters: input.parameters ?? {}
  });
}

// Confirmed live (2026-09-13): not paginated on this version, a plain array.
export function getPaperlessDocumentHistory(
  client: PaperlessClient,
  paperlessDocumentId: number
): Promise<PaperlessDocumentHistoryEntry[]> {
  return client.get<PaperlessDocumentHistoryEntry[]>(
    `/api/documents/${paperlessDocumentId}/history/`
  );
}

export function getPaperlessDocumentTypeName(
  client: PaperlessClient,
  documentTypeId: number
): Promise<string> {
  return client
    .get<{ name: string }>(`/api/document_types/${documentTypeId}/`)
    .then((dt) => dt.name);
}

// envelope.next is a full absolute URL (confirmed live) — PaperlessClient prepends its own
// baseUrl to whatever path it's given, so an absolute URL has to be cut back down to
// path+query before being passed to client.get() again.
function toRequestPath(absoluteUrl: string): string {
  const parsed = new URL(absoluteUrl);
  return `${parsed.pathname}${parsed.search}`;
}

// Confirmed live against the pinned instance (2026-09-12): pagination via `next`, and
// `added__gte`/`modified__gte`/`ordering`/`page_size` as query params all work as expected —
// an unrecognized param is silently ignored (200, no error), not rejected, so a typo'd filter
// name would fail quietly rather than loudly; keep query strings limited to these verified
// params. There is no confirmed sparse-fieldset support on this version, so this always pulls
// full document bodies — reconciliation only needs `id` out of them, but nothing here proves a
// cheaper shape is available.
export async function listAllPaperlessDocumentIds(
  client: PaperlessClient,
  queryString?: string
): Promise<Set<number>> {
  const ids = new Set<number>();
  let path: string | null = `/api/documents/?page_size=200${queryString ? `&${queryString}` : ""}`;

  while (path) {
    const envelope: PaperlessListEnvelope<{ id: number }> = await client.get(path);
    for (const doc of envelope.results) ids.add(doc.id);
    path = envelope.next ? toRequestPath(envelope.next) : null;
  }

  return ids;
}

// Full option lists for the documents filter bar (tags/document types) — always
// small (tens to low hundreds of rows for a real tenant), so one page is enough; still follows
// the `next`-pagination pattern in case a tenant genuinely has more than page_size.
async function listAllPaginated<T>(client: PaperlessClient, path: string): Promise<T[]> {
  const items: T[] = [];
  let next: string | null = path;
  while (next) {
    const envelope: PaperlessListEnvelope<T> = await client.get(next);
    items.push(...envelope.results);
    next = envelope.next ? toRequestPath(envelope.next) : null;
  }
  return items;
}

export type PaperlessMatchingFields = {
  match?: string;
  matching_algorithm?: number;
  is_insensitive?: boolean;
};

export type PaperlessTag = PaperlessMatchingFields & {
  id: number;
  name: string;
  color: string;
  text_color: string;
  document_count?: number;
};
export type PaperlessDocumentType = PaperlessMatchingFields & {
  id: number;
  name: string;
  document_count?: number;
};

export function listPaperlessTags(client: PaperlessClient): Promise<PaperlessTag[]> {
  return listAllPaginated<PaperlessTag>(client, "/api/tags/?page_size=200");
}

export function listPaperlessDocumentTypes(
  client: PaperlessClient
): Promise<PaperlessDocumentType[]> {
  return listAllPaginated<PaperlessDocumentType>(client, "/api/document_types/?page_size=200");
}

export function updatePaperlessTag(
  client: PaperlessClient,
  id: number,
  patch: Partial<Pick<PaperlessTag, "name" | "color" | "match" | "matching_algorithm" | "is_insensitive">>
): Promise<PaperlessTag> {
  return client.patch<PaperlessTag>(`/api/tags/${id}/`, patch);
}

export function updatePaperlessDocumentType(
  client: PaperlessClient,
  id: number,
  patch: Partial<Pick<PaperlessDocumentType, "name" | "match" | "matching_algorithm" | "is_insensitive">>
): Promise<PaperlessDocumentType> {
  return client.patch<PaperlessDocumentType>(`/api/document_types/${id}/`, patch);
}

export function deletePaperlessTag(client: PaperlessClient, id: number): Promise<void> {
  return client.delete(`/api/tags/${id}/`);
}

export function deletePaperlessDocumentType(client: PaperlessClient, id: number): Promise<void> {
  return client.delete(`/api/document_types/${id}/`);
}

// Confirmed live against the pinned instance: a bare `{name, data_type}` body works for every
// type except `select`, which requires `extra_data.select_options` to be a non-empty list of
// `{label}` objects (a plain string list 500s — the serializer calls `.get("label")` on each
// entry unconditionally). Paperless assigns each option's `id` itself if not supplied; that id,
// not the label, is what a document's value for this field must reference.
export function createPaperlessCustomField(
  client: PaperlessClient,
  input: {
    name: string;
    data_type: string;
    extra_data?: { select_options?: Array<{ label: string }> };
  },
  ownership: OwnedObjectPermissions
): Promise<PaperlessCustomField> {
  return client.createOwnedObject("/api/custom_fields/", input, ownership);
}

export function updatePaperlessCustomField(
  client: PaperlessClient,
  id: number,
  patch: { name?: string; extra_data?: { select_options?: Array<{ id?: string; label: string }> } }
): Promise<PaperlessCustomField> {
  return client.patch<PaperlessCustomField>(`/api/custom_fields/${id}/`, patch);
}

export function deletePaperlessCustomField(client: PaperlessClient, id: number): Promise<void> {
  return client.delete(`/api/custom_fields/${id}/`);
}

// Same page-scoped id__in pattern as getPaperlessDocumentTags — custom field *values* aren't
// mirrored locally, only definitions are (custom_field_defs), so this is always a live,
// page-scoped read, never cached across pages.
export async function getPaperlessDocumentCustomFields(
  client: PaperlessClient,
  paperlessDocumentIds: number[]
): Promise<Map<number, Array<{ field: number; value: unknown }>>> {
  if (paperlessDocumentIds.length === 0) return new Map();

  const params = new URLSearchParams({
    id__in: paperlessDocumentIds.join(","),
    page_size: String(paperlessDocumentIds.length)
  });
  const envelope = await client.get<
    PaperlessListEnvelope<{ id: number; custom_fields: Array<{ field: number; value: unknown }> }>
  >(`/api/documents/?${params.toString()}`);
  return new Map(envelope.results.map((r) => [r.id, r.custom_fields]));
}

export type { PaperlessCustomField, PaperlessCustomFieldSelectOption };

// Large-cards view mode only: a page-scoped read of `content` for the ~25 documents currently
// on screen. Confirmed live against the pinned instance (2026-09-16) that the list endpoint
// already returns full `content` per row (not a detail-only field) and that `id__in=` filters
// correctly — no sparse-fieldset support exists on this version, so the full document body
// comes back regardless, but capped to one page's worth of ids this is still cheap. Never
// cached, never written anywhere — specs/02-data-model.md's "we do not mirror OCR text" applies
// exactly as much to an in-memory cache as to a database column.
export async function getPaperlessContentSnippets(
  client: PaperlessClient,
  paperlessDocumentIds: number[]
): Promise<Map<number, string>> {
  if (paperlessDocumentIds.length === 0) return new Map();

  const params = new URLSearchParams({
    id__in: paperlessDocumentIds.join(","),
    page_size: String(paperlessDocumentIds.length)
  });
  const envelope = await client.get<PaperlessListEnvelope<{ id: number; content: string }>>(
    `/api/documents/?${params.toString()}`
  );
  return new Map(envelope.results.map((r) => [r.id, r.content]));
}

// Documents list page (all three view modes): a page-scoped read of `tags` for the ~25
// documents currently on screen, used to render each row/card's tag-color ribbon. Same
// id__in-scoped pattern as getPaperlessContentSnippets — tags aren't mirrored locally (only
// Paperless-native), so this is always a live, page-scoped call, never cached across pages.
export async function getPaperlessDocumentTags(
  client: PaperlessClient,
  paperlessDocumentIds: number[]
): Promise<Map<number, number[]>> {
  if (paperlessDocumentIds.length === 0) return new Map();

  const params = new URLSearchParams({
    id__in: paperlessDocumentIds.join(","),
    page_size: String(paperlessDocumentIds.length)
  });
  const envelope = await client.get<PaperlessListEnvelope<{ id: number; tags: number[] }>>(
    `/api/documents/?${params.toString()}`
  );
  return new Map(envelope.results.map((r) => [r.id, r.tags]));
}

// documents.document_type_key has no canonical source (specs/02-data-model.md gives it as a
// bare `text` column, no FK, no established slug convention) — lowercase + underscore the
// Paperless document_type's own name as a defensible, documented choice rather than leaving it
// unresolved. Revisit if a real document_types mirror table is ever introduced.
export function toDocumentTypeKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
