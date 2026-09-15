import { Queue, type JobsOptions } from "bullmq";

import { getRedisClient } from "@/lib/redis";

import { getQueueRuntimeConfig } from "./config";
export { QUEUE_NAMES } from "./names";
export type { QueueName } from "./names";
import type { QueueName } from "./names";

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
    connection: getRedisClient(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 1_000 },
      ...getQueueRuntimeConfig(name).defaultJobOptions
    }
  });
  queues.set(name, queue);
  return queue;
}

// Payload must include orgId — buildJobContext() (worker/context.ts) depends on it.
export async function enqueue<TPayload extends { orgId: string }>(
  name: QueueName,
  payload: TPayload,
  options?: JobsOptions
) {
  const queue = getQueue(name);
  return queue.add(name, payload, options);
}

export async function enqueueBulk<TPayload extends { orgId: string }>(
  name: QueueName,
  payloads: TPayload[],
  options?: JobsOptions
) {
  const queue = getQueue(name);
  return queue.addBulk(payloads.map((payload) => ({ name, data: payload, opts: options })));
}
