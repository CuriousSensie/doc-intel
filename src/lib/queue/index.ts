import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

import { env } from "@/lib/env";

/**
 * BullMQ queue names. Every producer (Server Actions enqueueing work) and every consumer
 * (worker/registry.ts) imports names from here rather than passing raw strings — a typo in a
 * queue name is a job that silently never runs.
 */
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

/**
 * One shared ioredis connection for every Queue instance in this process. BullMQ Workers
 * (worker/index.ts) create their own connection per Worker by design — this one is for
 * producers only (Server Actions enqueueing jobs).
 */
function getConnection(): ConnectionOptions {
  if (!connection) {
    connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  }

  return connection;
}

const queues = new Map<QueueName, Queue>();

/** Returns a memoized BullMQ Queue for the given name, creating it on first use. */
export function getQueue(name: QueueName): Queue {
  const existing = queues.get(name);

  if (existing) {
    return existing;
  }

  const queue = new Queue(name, { connection: getConnection() });
  queues.set(name, queue);
  return queue;
}

/**
 * Enqueues a job. Every job payload MUST include `orgId` — worker/context.ts#buildJobContext()
 * depends on it being present to scope every query the job's handler issues (see
 * docs/adr/0007-service-context-pattern.md).
 */
export async function enqueue<TPayload extends { orgId: string }>(
  name: QueueName,
  payload: TPayload,
  options?: Parameters<Queue["add"]>[2]
) {
  const queue = getQueue(name);
  return queue.add(name, payload, options);
}
