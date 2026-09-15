import type { Job, Processor } from "bullmq";

import { logger } from "@/lib/logger";
import { QUEUE_NAMES, type QueueName } from "@/lib/queue";

import type { JobPayload } from "./context";
import { bulkActionJob } from "./jobs/bulk-action";
import { expireAbandonedUploadsJob } from "./jobs/expire-abandoned-uploads";
import { exportJob } from "./jobs/export";
import { ingestDocumentJob } from "./jobs/ingest-document";
import { pollPaperlessTasksJob } from "./jobs/poll-paperless-tasks";
import { provisionTenantJob } from "./jobs/provision-tenant";
import { reconcileFullSweepJob } from "./jobs/reconcile-full-sweep";
import { reconcileIncrementalJob } from "./jobs/reconcile-incremental";
import { runImportChunkJob } from "./jobs/run-import-chunk";
import { syncPaperlessDocumentJob } from "./jobs/sync-paperless-document";

const notImplemented =
  (name: QueueName): Processor<JobPayload> =>
  async (job: Job<JobPayload>) => {
    logger.error("worker.job_not_implemented", {
      queue: name,
      jobId: job.id,
      orgId: job.data.orgId
    });
    throw new Error(
      `Job handler for "${name}" is not implemented yet (see docs/IMPLEMENTATION_PLAN.md)`
    );
  };

const noOp =
  (name: QueueName): Processor<JobPayload> =>
  async (job: Job<JobPayload>) => {
    logger.info("worker.job_noop", {
      queue: name,
      jobId: job.id,
      orgId: job.data.orgId
    });
  };

export const jobRegistry: Record<QueueName, Processor<JobPayload>> = {
  [QUEUE_NAMES.provisionTenant]: provisionTenantJob,
  [QUEUE_NAMES.ingestDocument]: ingestDocumentJob,
  [QUEUE_NAMES.pollPaperlessTasks]: pollPaperlessTasksJob,
  [QUEUE_NAMES.syncPaperlessDocument]: syncPaperlessDocumentJob,
  [QUEUE_NAMES.expireAbandonedUploads]: expireAbandonedUploadsJob,
  [QUEUE_NAMES.reconcileIncremental]: reconcileIncrementalJob,
  [QUEUE_NAMES.reconcileFullSweep]: reconcileFullSweepJob,
  [QUEUE_NAMES.runRule]: noOp(QUEUE_NAMES.runRule),
  [QUEUE_NAMES.backfillRule]: notImplemented(QUEUE_NAMES.backfillRule),
  [QUEUE_NAMES.fireDueReminders]: notImplemented(QUEUE_NAMES.fireDueReminders),
  [QUEUE_NAMES.runImportChunk]: runImportChunkJob,
  [QUEUE_NAMES.bulkAction]: bulkActionJob,
  [QUEUE_NAMES.export]: exportJob
};
