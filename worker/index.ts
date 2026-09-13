import { Worker } from "bullmq";
import IORedis from "ioredis";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";

import { jobRegistry } from "./registry";

const EXPIRE_ABANDONED_UPLOADS_INTERVAL_MS = 5 * 60 * 1000;
// specs/01-architecture.md §Event bridge: the incremental sweep runs every 5 minutes, per tenant.
const RECONCILE_INCREMENTAL_INTERVAL_MS = 5 * 60 * 1000;
// docs/IMPLEMENTATION_PLAN.md: the full sweep (deletion detection) runs daily.
const RECONCILE_FULL_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Registers this worker's recurring (non-tenant-triggered) jobs via BullMQ v6's JobScheduler —
// upsertJobScheduler() is keyed by jobSchedulerId, so calling this on every boot (including a
// container restart) updates the existing schedule instead of piling up duplicates. orgId is an
// unused placeholder on every one of these — each sweep loops over every tenant internally, but
// every job payload still carries the base JobPayload shape (worker/context.ts) by convention.
async function registerSchedules() {
  await getQueue(QUEUE_NAMES.expireAbandonedUploads).upsertJobScheduler(
    QUEUE_NAMES.expireAbandonedUploads,
    { every: EXPIRE_ABANDONED_UPLOADS_INTERVAL_MS },
    { data: { orgId: "system" } }
  );

  await getQueue(QUEUE_NAMES.reconcileIncremental).upsertJobScheduler(
    QUEUE_NAMES.reconcileIncremental,
    { every: RECONCILE_INCREMENTAL_INTERVAL_MS },
    { data: { orgId: "system" } }
  );

  await getQueue(QUEUE_NAMES.reconcileFullSweep).upsertJobScheduler(
    QUEUE_NAMES.reconcileFullSweep,
    { every: RECONCILE_FULL_SWEEP_INTERVAL_MS },
    { data: { orgId: "system" } }
  );
}

// Entrypoint for the `worker` container (Dockerfile.worker). Boots one BullMQ Worker per queue.
function main() {
  const workers = Object.values(QUEUE_NAMES).map((name) => {
    // Own connection per Worker, per BullMQ's recommendation (unlike Queue producers, shared).
    const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

    const worker = new Worker(name, jobRegistry[name], { connection });

    worker.on("completed", (job) => {
      logger.info("worker.job_completed", { queue: name, jobId: job.id, orgId: job.data.orgId });
    });

    worker.on("failed", (job, error) => {
      logger.error("worker.job_failed", {
        queue: name,
        jobId: job?.id,
        orgId: job?.data?.orgId,
        errorMessage: error.message
      });
    });

    return worker;
  });

  logger.info("worker.started", { queues: Object.values(QUEUE_NAMES).join(",") });

  const shutdown = async (signal: string) => {
    logger.info("worker.shutting_down", { signal });
    await Promise.all(workers.map((worker) => worker.close()));
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  registerSchedules().catch((err) => {
    logger.error("worker.register_schedules_failed", {
      errorMessage: err instanceof Error ? err.message : String(err)
    });
  });
}

main();
