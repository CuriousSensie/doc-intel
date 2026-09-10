import { Worker } from "bullmq";
import IORedis from "ioredis";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { QUEUE_NAMES } from "@/lib/queue";

import { jobRegistry } from "./registry";

/**
 * Boots one BullMQ Worker per queue in the registry. This is the entrypoint for the
 * `worker` container in infra/docker-compose.yml (Dockerfile.worker) — it shares every
 * src/modules and src/lib module with the Next.js app (docs/adr/0002) but runs as a plain
 * Node process with no request lifecycle (docs/adr/0007).
 */
function main() {
  const workers = Object.values(QUEUE_NAMES).map((name) => {
    // Each Worker gets its own Redis connection per BullMQ's recommendation — connections
    // are not meant to be shared between Workers the way Queue producer connections are.
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
}

main();
