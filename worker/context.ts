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
