import type { Job } from "bullmq";

import { validateUpload } from "@/modules/documents/validate-upload";

import { isLastAttempt, type JobPayload } from "../context";

type ValidateUploadPayload = JobPayload & { uploadId: string };

export async function validateUploadJob(job: Job<JobPayload>): Promise<void> {
  const { orgId, uploadId } = job.data as ValidateUploadPayload;
  if (!uploadId) {
    throw new Error("validate-upload job payload missing uploadId");
  }
  await validateUpload(orgId, uploadId, isLastAttempt(job));
}
