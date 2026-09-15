// Phase 3 source files are uploaded directly to private Storage via signed URLs.
export const importsConfig = {
  bucket: "import-sources",
  maxSizeBytes: 100 * 1024 * 1024,
  maxRows: 50_000,
  chunkSize: 50,
  defaultConcurrencyPerOrganization: 4,
  allowedExtensions: [".csv", ".tsv", ".xlsx", ".zip"]
} as const;
