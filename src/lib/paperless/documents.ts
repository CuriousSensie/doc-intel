import type { PaperlessClient } from "./client";
import type { PaperlessDocument } from "./types";

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
