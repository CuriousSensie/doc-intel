import type { JobsOptions, WorkerOptions } from "bullmq";

import { rulesConfig } from "@/config/rules";
import { env } from "@/lib/env";

import { QUEUE_NAMES, type QueueName } from "./names";

export type QueueRuntimeConfig = {
  worker: Pick<WorkerOptions, "concurrency" | "limiter">;
  defaultJobOptions?: Pick<JobsOptions, "priority">;
};

const ONE_SECOND_MS = 1_000;

export const QUEUE_PRIORITY = {
  interactiveUpload: 1,
  ruleBackfill: 10
} as const;

export const queueRuntimeConfig: Record<QueueName, QueueRuntimeConfig> = {
  [QUEUE_NAMES.provisionTenant]: { worker: { concurrency: 1 } },
  // No blocking Paperless wait inside this job anymore (poll-paperless-tasks.ts owns that) —
  // its own limiter still caps submissions/sec so a burst of ingest jobs can't flood
  // post_document/ faster than Paperless (and the per-org token bucket) can take it.
  [QUEUE_NAMES.ingestDocument]: {
    worker: {
      concurrency: env.WORKER_INGEST_CONCURRENCY,
      limiter: {
        max: env.PAPERLESS_INGEST_RATE_PER_SECOND,
        duration: ONE_SECOND_MS
      }
    },
    defaultJobOptions: { priority: QUEUE_PRIORITY.interactiveUpload }
  },
  // One scheduler tick per interval (worker/index.ts), not per-document — concurrency 1 is
  // correct here, not a throughput cap (see poll-paperless-tasks.ts for why).
  [QUEUE_NAMES.pollPaperlessTasks]: { worker: { concurrency: 1 } },
  [QUEUE_NAMES.syncPaperlessDocument]: { worker: { concurrency: env.WORKER_INGEST_CONCURRENCY } },
  [QUEUE_NAMES.expireAbandonedUploads]: { worker: { concurrency: 1 } },
  [QUEUE_NAMES.reconcileIncremental]: { worker: { concurrency: 1 } },
  [QUEUE_NAMES.reconcileFullSweep]: { worker: { concurrency: 1 } },
  // Fans out one job per (document, trigger) fire from several call sites — needs real
  // throughput, not "one at a time," the same reasoning as syncPaperlessDocument's own
  // concurrency (matches WORKER_INGEST_CONCURRENCY since document.ingested/.updated fire at
  // exactly the same rate as sync-paperless-document.ts's own job volume).
  [QUEUE_NAMES.runRule]: { worker: { concurrency: env.WORKER_INGEST_CONCURRENCY } },
  // Self-perpetuating chain (worker/jobs/backfill-rule.ts) — one chunk in flight per running
  // backfill regardless of this number.
  [QUEUE_NAMES.backfillRule]: {
    worker: { concurrency: rulesConfig.defaultBackfillConcurrencyPerOrganization },
    defaultJobOptions: { priority: QUEUE_PRIORITY.ruleBackfill }
  },
  // One scheduler tick per interval (worker/index.ts) — same reasoning as pollPaperlessTasks.
  [QUEUE_NAMES.fireDueReminders]: { worker: { concurrency: 1 } },
  [QUEUE_NAMES.export]: { worker: { concurrency: 1 } }
};

export function getQueueRuntimeConfig(name: QueueName): QueueRuntimeConfig {
  return queueRuntimeConfig[name];
}
