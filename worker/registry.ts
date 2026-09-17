import type { Processor } from "bullmq";

import { QUEUE_NAMES, type QueueName } from "@/lib/queue";

import type { JobPayload } from "./context";
import { backfillRuleJob } from "./jobs/backfill-rule";
import { bulkActionJob } from "./jobs/bulk-action";
import { expireAbandonedUploadsJob } from "./jobs/expire-abandoned-uploads";
import { exportJob } from "./jobs/export";
import { fireDueRemindersJob } from "./jobs/fire-due-reminders";
import { ingestDocumentJob } from "./jobs/ingest-document";
import { pollPaperlessTasksJob } from "./jobs/poll-paperless-tasks";
import { provisionTenantJob } from "./jobs/provision-tenant";
import { reconcileFullSweepJob } from "./jobs/reconcile-full-sweep";
import { reconcileIncrementalJob } from "./jobs/reconcile-incremental";
import { runImportChunkJob } from "./jobs/run-import-chunk";
import { runRuleJob } from "./jobs/run-rule";
import { syncPaperlessDocumentJob } from "./jobs/sync-paperless-document";

export const jobRegistry: Record<QueueName, Processor<JobPayload>> = {
  [QUEUE_NAMES.provisionTenant]: provisionTenantJob,
  [QUEUE_NAMES.ingestDocument]: ingestDocumentJob,
  [QUEUE_NAMES.pollPaperlessTasks]: pollPaperlessTasksJob,
  [QUEUE_NAMES.syncPaperlessDocument]: syncPaperlessDocumentJob,
  [QUEUE_NAMES.expireAbandonedUploads]: expireAbandonedUploadsJob,
  [QUEUE_NAMES.reconcileIncremental]: reconcileIncrementalJob,
  [QUEUE_NAMES.reconcileFullSweep]: reconcileFullSweepJob,
  [QUEUE_NAMES.runRule]: runRuleJob,
  [QUEUE_NAMES.backfillRule]: backfillRuleJob,
  [QUEUE_NAMES.fireDueReminders]: fireDueRemindersJob,
  [QUEUE_NAMES.runImportChunk]: runImportChunkJob,
  [QUEUE_NAMES.bulkAction]: bulkActionJob,
  [QUEUE_NAMES.export]: exportJob
};
