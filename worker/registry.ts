import type { Job, Processor } from "bullmq";

import { logger } from "@/lib/logger";
import { QUEUE_NAMES, type QueueName } from "@/lib/queue";

import type { JobPayload } from "./context";

/**
 * Maps a queue name to the handler that processes its jobs. worker/index.ts creates one
 * BullMQ Worker per entry here.
 *
 * Every handler below is a placeholder pending its real implementation — see
 * docs/IMPLEMENTATION_PLAN.md's Phase 1/3/4 checklists for what each one does and which spec
 * section it implements. They exist now so `docker compose up` boots a working worker process
 * (infra deliverable) without silently claiming product-level functionality that isn't built
 * yet — each one logs loudly and fails the job rather than pretending to succeed.
 */
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
  [QUEUE_NAMES.provisionTenant]: notImplemented(QUEUE_NAMES.provisionTenant),
  [QUEUE_NAMES.validateUpload]: notImplemented(QUEUE_NAMES.validateUpload),
  [QUEUE_NAMES.submitUploadToPaperless]: notImplemented(QUEUE_NAMES.submitUploadToPaperless),
  [QUEUE_NAMES.syncPaperlessDocument]: notImplemented(QUEUE_NAMES.syncPaperlessDocument),
  [QUEUE_NAMES.expireAbandonedUploads]: notImplemented(QUEUE_NAMES.expireAbandonedUploads),
  [QUEUE_NAMES.reconcileIncremental]: notImplemented(QUEUE_NAMES.reconcileIncremental),
  [QUEUE_NAMES.reconcileFullSweep]: notImplemented(QUEUE_NAMES.reconcileFullSweep),
  [QUEUE_NAMES.runRule]: notImplemented(QUEUE_NAMES.runRule),
  [QUEUE_NAMES.backfillRule]: notImplemented(QUEUE_NAMES.backfillRule),
  [QUEUE_NAMES.fireDueReminders]: notImplemented(QUEUE_NAMES.fireDueReminders),
  [QUEUE_NAMES.runImportRow]: notImplemented(QUEUE_NAMES.runImportRow),
  [QUEUE_NAMES.bulkAction]: notImplemented(QUEUE_NAMES.bulkAction),
  [QUEUE_NAMES.export]: notImplemented(QUEUE_NAMES.export)
};
