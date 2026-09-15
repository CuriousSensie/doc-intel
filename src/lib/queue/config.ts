import type { JobsOptions, WorkerOptions } from "bullmq";

import { env } from "@/lib/env";

import { QUEUE_NAMES, type QueueName } from "./names";

export type QueueRuntimeConfig = {
  worker: Pick<WorkerOptions, "concurrency" | "limiter">;
  defaultJobOptions?: Pick<JobsOptions, "priority">;
};

const ONE_SECOND_MS = 1_000;

export const QUEUE_PRIORITY = {
  interactiveUpload: 1,
  importRow: 10
} as const;

export const queueRuntimeConfig: Record<QueueName, QueueRuntimeConfig> = {
  [QUEUE_NAMES.provisionTenant]: { worker: { concurrency: 1 } },
  [QUEUE_NAMES.validateUpload]: { worker: { concurrency: env.WORKER_INGEST_CONCURRENCY } },
  [QUEUE_NAMES.submitUploadToPaperless]: {
    worker: {
      concurrency: env.WORKER_INGEST_CONCURRENCY,
      limiter: {
        max: env.PAPERLESS_INGEST_RATE_PER_SECOND,
        duration: ONE_SECOND_MS
      }
    },
    defaultJobOptions: { priority: QUEUE_PRIORITY.interactiveUpload }
  },
  [QUEUE_NAMES.syncPaperlessDocument]: { worker: { concurrency: env.WORKER_INGEST_CONCURRENCY } },
  [QUEUE_NAMES.expireAbandonedUploads]: { worker: { concurrency: 1 } },
  [QUEUE_NAMES.reconcileIncremental]: { worker: { concurrency: 1 } },
  [QUEUE_NAMES.reconcileFullSweep]: { worker: { concurrency: 1 } },
  [QUEUE_NAMES.runRule]: { worker: { concurrency: 1 } },
  [QUEUE_NAMES.backfillRule]: { worker: { concurrency: 1 } },
  [QUEUE_NAMES.fireDueReminders]: { worker: { concurrency: 1 } },
  [QUEUE_NAMES.runImportRow]: {
    worker: { concurrency: env.WORKER_INGEST_CONCURRENCY },
    defaultJobOptions: { priority: QUEUE_PRIORITY.importRow }
  },
  [QUEUE_NAMES.bulkAction]: { worker: { concurrency: 1 } },
  [QUEUE_NAMES.export]: { worker: { concurrency: 1 } }
};

export function getQueueRuntimeConfig(name: QueueName): QueueRuntimeConfig {
  return queueRuntimeConfig[name];
}
