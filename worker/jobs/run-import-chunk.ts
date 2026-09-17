import type { Job } from "bullmq";

import { runImportChunk } from "@/modules/imports/run-import-chunk";

import type { JobPayload } from "../context";

type RunImportChunkPayload = JobPayload & { importJobId: string };

export async function runImportChunkJob(job: Job<JobPayload>): Promise<void> {
  const { orgId, importJobId } = job.data as RunImportChunkPayload;
  if (!importJobId) {
    throw new Error("run-import-chunk job payload missing importJobId");
  }
  await runImportChunk(orgId, importJobId);
}
