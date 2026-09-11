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

  const queue = new Queue(name, { connection: getConnection() });
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
