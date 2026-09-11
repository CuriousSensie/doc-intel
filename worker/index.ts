import { Worker } from "bullmq";
import IORedis from "ioredis";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { QUEUE_NAMES } from "@/lib/queue";

import { jobRegistry } from "./registry";

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
}

main();
