// Single source of truth for queue names — a raw-string typo is a job that never runs.
export const QUEUE_NAMES = {
  provisionTenant: "provision-tenant",
  // Merged validate-upload + submit-upload-to-paperless (Phase 3 M3): one queue hop instead of
  // two, one file download instead of two, and no blocking in-job wait for Paperless — see
  // ingest-document.ts and poll-paperless-tasks.ts.
  ingestDocument: "ingest-document",
  pollPaperlessTasks: "poll-paperless-tasks",
  syncPaperlessDocument: "sync-paperless-document",
  expireAbandonedUploads: "expire-abandoned-uploads",
  reconcileIncremental: "reconcile-incremental",
  reconcileFullSweep: "reconcile-full-sweep",
  runRule: "run-rule",
  backfillRule: "backfill-rule",
  fireDueReminders: "fire-due-reminders",
  runImportRow: "run-import-row",
  bulkAction: "bulk-action",
  export: "export"
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
