// Single source of truth for queue names — a raw-string typo is a job that never runs.
export const QUEUE_NAMES = {
  provisionTenant: "provision-tenant",
  validateUpload: "validate-upload",
  submitUploadToPaperless: "submit-upload-to-paperless",
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
