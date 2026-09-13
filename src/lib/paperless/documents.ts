import type { PaperlessClient } from "./client";
import type { PaperlessDocument, PaperlessListEnvelope } from "./types";

export function getPaperlessDocument(
  client: PaperlessClient,
  paperlessDocumentId: number
): Promise<PaperlessDocument> {
  return client.get<PaperlessDocument>(`/api/documents/${paperlessDocumentId}/`);
}

export function getPaperlessDocumentTypeName(
  client: PaperlessClient,
  documentTypeId: number
): Promise<string> {
  return client
    .get<{ name: string }>(`/api/document_types/${documentTypeId}/`)
    .then((dt) => dt.name);
}

export function getPaperlessCorrespondentName(
  client: PaperlessClient,
  correspondentId: number
): Promise<string> {
  return client
    .get<{ name: string }>(`/api/correspondents/${correspondentId}/`)
    .then((c) => c.name);
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
