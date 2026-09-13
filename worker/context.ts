import type { Job } from "bullmq";

import { buildJobContext, type ServiceContext } from "@/lib/service-context";

// Every job payload must carry orgId (docs/adr/0007). Handlers extend this.
export type JobPayload = {
  orgId: string;
  actorId?: string | null;
  correlationId?: string;
};

export function contextForJob(job: Job<JobPayload>): ServiceContext {
  return buildJobContext({
    orgId: job.data.orgId,
    actorId: job.data.actorId,
    correlationId: job.data.correlationId ?? job.id
  });
}

// job.attemptsMade counts completed attempts *before* this run (BullMQ increments it after a
// failure, not before the processor executes — src/lib/queue/index.ts's defaultJobOptions is
// what makes `opts.attempts` > 1 at all). A job handler uses this to decide whether a failure
// is final (write a terminal 'failed' status) or will still be retried (leave the row in its
// in-progress status so the retry's own claim/resumability logic can pick it back up).
export function isLastAttempt(job: Job<JobPayload>): boolean {
  const maxAttempts = job.opts.attempts ?? 1;
  return job.attemptsMade + 1 >= maxAttempts;
}
