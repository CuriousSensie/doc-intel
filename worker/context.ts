import type { Job } from "bullmq";

import { buildJobContext, type ServiceContext } from "@/lib/service-context";

/**
 * Every job payload processed by this worker must carry `orgId` — see
 * docs/adr/0007-service-context-pattern.md. Handlers extend this with their own payload shape.
 */
export type JobPayload = {
  orgId: string;
  actorId?: string | null;
  correlationId?: string;
};

/** Builds a ServiceContext from a BullMQ job for use inside a job handler. */
export function contextForJob(job: Job<JobPayload>): ServiceContext {
  return buildJobContext({
    orgId: job.data.orgId,
    actorId: job.data.actorId,
    correlationId: job.data.correlationId ?? job.id
  });
}
