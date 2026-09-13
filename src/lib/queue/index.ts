import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

import { env } from "@/lib/env";

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

let connection: IORedis | null = null;

// Shared connection for producers only — Workers (worker/index.ts) create their own per BullMQ's
// recommendation.
function getConnection(): ConnectionOptions {
  if (!connection) {
    connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  }

  return connection;
}

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  const existing = queues.get(name);

  if (existing) {
    return existing;
  }

  // No job here configured any retry policy — BullMQ's own default is `attempts: 1`, so a
  // one-off transient failure (a network blip on a single Paperless POST, found live during
  // e2e testing: an isolated "fetch failed" that succeeded on a bare retry moments later)
  // permanently failed the job with zero retries, contradicting every job's own resumability
  // design (checkpointing via paperless_task_id, conditional claims, etc. all assume a retry
  // actually happens). 3 attempts, exponential backoff — same attempt count as
  // PaperlessClient's own idempotent-GET retry (src/lib/paperless/client.ts's MAX_RETRIES).
  const queue = new Queue(name, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 }
    }
  });
  queues.set(name, queue);
  return queue;
}

// Payload must include orgId — buildJobContext() (worker/context.ts) depends on it.
export async function enqueue<TPayload extends { orgId: string }>(
  name: QueueName,
  payload: TPayload,
  options?: Parameters<Queue["add"]>[2]
) {
  const queue = getQueue(name);
  return queue.add(name, payload, options);
}
