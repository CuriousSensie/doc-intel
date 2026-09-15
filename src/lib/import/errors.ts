// specs/06-importer.md §Reporting: the exact, closed set of per-row error codes the report CSV
// and the review screen key off. Never a free-text code — the UI and the retry-failed flow
// both switch on this.
export const IMPORT_ERROR_CODES = [
  "PARSE_ERROR",
  "MISSING_REQUIRED",
  "INVALID_DATE",
  "INVALID_NUMBER",
  "ENTITY_NOT_FOUND",
  "IDENTIFIER_CONFLICT",
  "DOCUMENT_NOT_FOUND",
  "FILE_MISSING_IN_ARCHIVE",
  "DUPLICATE",
  "PAPERLESS_ERROR",
  "UNKNOWN"
] as const;

export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

// Thrown by the parsing/locale layer (src/lib/import/*) and by the row-execution layer (Phase 3
// M5/M6) alike — one taxonomy end to end, so a row's error_code column always means the same
// thing regardless of which stage produced it.
export class ImportRowError extends Error {
  constructor(
    public readonly code: ImportErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ImportRowError";
  }
}
