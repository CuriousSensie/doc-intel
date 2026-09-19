// Documenti document uploads. Direct-to-storage (specs/01-architecture.md §Upload), not
// server-buffered like avatar upload.
export const documentsConfig = {
  bucket: "document-uploads",
  // No spec'd number — Paperless/Tesseract handle large multi-page scans. Tune from real usage
  // once there is any.
  maxSizeBytes: 100 * 1024 * 1024,
  allowedMimeTypes: <string[]>[
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/tiff",
    // Gotenberg/Tika (infra/docker-compose.yml) convert these for Paperless.
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.oasis.opendocument.text"
  ],
  // Supabase's createSignedUploadUrl() has a fixed 2h expiry, not configurable — this is our
  // own document_uploads.expires_at window (shorter, since a real upload starts in seconds),
  // used only for expire-abandoned-uploads.ts's sweep, not the signed URL itself.
  pendingExpiryMinutes: 60
} as const;
