import type { Job } from "bullmq";

import { provisionTenant } from "@/modules/tenants/provision-tenant";

import type { JobPayload } from "../context";

export async function provisionTenantJob(job: Job<JobPayload>): Promise<void> {
  await provisionTenant(job.data.orgId);
}
