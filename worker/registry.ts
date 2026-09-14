import type { Job, Processor } from "bullmq";

import { logger } from "@/lib/logger";
import { QUEUE_NAMES, type QueueName } from "@/lib/queue";

import type { JobPayload } from "./context";
import { bulkActionJob } from "./jobs/bulk-action";
import { expireAbandonedUploadsJob } from "./jobs/expire-abandoned-uploads";
import { exportJob } from "./jobs/export";
import { provisionTenantJob } from "./jobs/provision-tenant";
import { reconcileFullSweepJob } from "./jobs/reconcile-full-sweep";
import { reconcileIncrementalJob } from "./jobs/reconcile-incremental";
import { submitUploadToPaperlessJob } from "./jobs/submit-upload-to-paperless";
import { syncPaperlessDocumentJob } from "./jobs/sync-paperless-document";
import { validateUploadJob } from "./jobs/validate-upload";

// Placeholders until each real handler lands (see docs/IMPLEMENTATION_PLAN.md) — loud failure,
// not a silent no-op, so `docker compose up` boots a working worker without faking progress.
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

export const jobRegistry: Record<QueueName, Processor<JobPayload>> = {
  [QUEUE_NAMES.provisionTenant]: provisionTenantJob,
  [QUEUE_NAMES.validateUpload]: validateUploadJob,
  [QUEUE_NAMES.submitUploadToPaperless]: submitUploadToPaperlessJob,
  [QUEUE_NAMES.syncPaperlessDocument]: syncPaperlessDocumentJob,
  [QUEUE_NAMES.expireAbandonedUploads]: expireAbandonedUploadsJob,
  [QUEUE_NAMES.reconcileIncremental]: reconcileIncrementalJob,
  [QUEUE_NAMES.reconcileFullSweep]: reconcileFullSweepJob,
  [QUEUE_NAMES.runRule]: notImplemented(QUEUE_NAMES.runRule),
  [QUEUE_NAMES.backfillRule]: notImplemented(QUEUE_NAMES.backfillRule),
  [QUEUE_NAMES.fireDueReminders]: notImplemented(QUEUE_NAMES.fireDueReminders),
  [QUEUE_NAMES.runImportRow]: notImplemented(QUEUE_NAMES.runImportRow),
  [QUEUE_NAMES.bulkAction]: bulkActionJob,
  [QUEUE_NAMES.export]: exportJob
};
