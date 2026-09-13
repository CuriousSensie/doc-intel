import type { Job } from "bullmq";

import { submitUploadToPaperless } from "@/modules/documents/submit-upload-to-paperless";

import { isLastAttempt, type JobPayload } from "../context";

type SubmitUploadPayload = JobPayload & { uploadId: string };

export async function submitUploadToPaperlessJob(job: Job<JobPayload>): Promise<void> {
  const { orgId, uploadId } = job.data as SubmitUploadPayload;
  if (!uploadId) {
    throw new Error("submit-upload-to-paperless job payload missing uploadId");
  }
  await submitUploadToPaperless(orgId, uploadId, isLastAttempt(job));
}
