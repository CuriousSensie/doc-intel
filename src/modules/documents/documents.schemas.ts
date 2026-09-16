import { z } from "zod";

// specs/12-agent-rules.md "Always do these" #2: shared Zod schema for the filter/sort
// querystring, reused by the page's searchParams parsing and every server action that takes a
// ListDocumentsOptions-shaped filter. Every field is optional — an empty object is "all
// documents", the same default the page already had before any of this existed.
export const documentStatusSchema = z.enum([
  "pending",
  "processing",
  "ready",
  "failed",
  "orphaned"
]);

export const documentSortSchema = z.enum(["created", "title", "mimeType", "size", "pages"]);
export const documentSortDirectionSchema = z.enum(["asc", "desc"]);
export const documentViewModeSchema = z.enum(["list", "smallCards", "largeCards"]);
export const documentListFieldSchema = z.enum([
  "title",
  "tags",
  "correspondent",
  "documentType",
  "connections",
  "pages",
  "createdAt"
]);
export const DEFAULT_DOCUMENT_LIST_FIELDS: DocumentListField[] = [
  "title",
  "tags",
  "correspondent",
  "documentType",
  "connections",
  "pages",
  "createdAt"
];

export const listDocumentsFilterSchema = z.object({
  documentTypeKey: z.string().min(1).optional(),
  status: documentStatusSchema.optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  q: z.string().min(1).optional(),
  // Search mode for `q` — full text (title + content, Paperless's default `query=`) vs.
  // title-only (`title__icontains=`). Meaningless without `q`, harmlessly ignored if set alone.
  titleOnly: z.boolean().optional(),
  tagIds: z.array(z.coerce.number().int().positive()).optional(),
  correspondentId: z.coerce.number().int().positive().optional(),
  entityId: z.string().uuid().optional(),
  hasNoConnections: z.boolean().optional(),
  sort: documentSortSchema.optional(),
  sortDirection: documentSortDirectionSchema.optional(),
  cursor: z.string().optional()
});

// Kept separate from the filter schema above — `view` never reaches listDocuments()/the
// server actions, it only decides which component renders and whether the page needs the
// extra Large-Cards content-snippet fetch. Driven by the URL (not localStorage) so a plain
// reload keeps it and a shared link reproduces exactly what the sender saw.
export const documentsViewSearchParamSchema = z.object({
  view: documentViewModeSchema.optional(),
  fields: z.array(documentListFieldSchema).optional()
});

export type ListDocumentsFilter = z.infer<typeof listDocumentsFilterSchema>;
export type DocumentListField = z.infer<typeof documentListFieldSchema>;

// Parses the raw `searchParams` object Next.js hands a Server Component page — string/undefined
// for everything, comma-joined for the one array field, "true"/"false" for booleans. Invalid
// input is dropped (treated as unset) rather than thrown, matching how the page already behaved
// before any filter had real validation (a malformed URL degrades to a broader/default view,
// never a 500).
export function parseDocumentsSearchParams(
  raw: Record<string, string | string[] | undefined>
): ListDocumentsFilter {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const candidate = {
    documentTypeKey: first(raw.documentTypeKey),
    status: first(raw.status),
    dateFrom: first(raw.dateFrom),
    dateTo: first(raw.dateTo),
    q: first(raw.q),
    titleOnly: first(raw.titleOnly) === "true",
    tagIds: first(raw.tagIds)
      ? first(raw.tagIds)!
          .split(",")
          .map((v) => Number(v))
          .filter((n) => Number.isFinite(n))
      : undefined,
    correspondentId: first(raw.correspondentId),
    entityId: first(raw.entityId),
    hasNoConnections: first(raw.hasNoConnections) === "true",
    sort: first(raw.sort),
    sortDirection: first(raw.sortDirection),
    cursor: first(raw.cursor)
  };

  const result = listDocumentsFilterSchema.safeParse(candidate);
  return result.success ? result.data : {};
}

export function parseDocumentListFields(
  raw: Record<string, string | string[] | undefined>
): DocumentListField[] {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const fields = first(raw.fields)
    ?.split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const result = documentsViewSearchParamSchema.safeParse({ fields });
  return result.success && result.data.fields?.length
    ? result.data.fields
    : DEFAULT_DOCUMENT_LIST_FIELDS;
}

// Document detail page's Details tab — every field optional, only the ones actually changed
// are sent (updateDocument() only builds a Paperless patch for keys present on the input).
export const updateDocumentSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  documentDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  documentTypeId: z.number().int().positive().nullable().optional(),
  correspondentId: z.number().int().positive().nullable().optional(),
  tagIds: z.array(z.number().int().positive()).optional()
});

export const paperlessMetaKindSchema = z.enum(["tag", "correspondent", "documentType"]);

export const createPaperlessMetaSchema = z.object({
  kind: paperlessMetaKindSchema,
  name: z.string().trim().min(1).max(200),
  // Tags only — ignored server-side for correspondent/documentType (Paperless doesn't color
  // those). Hex string, e.g. "#a6cee3".
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
});
