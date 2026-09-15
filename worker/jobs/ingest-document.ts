import type { Job } from "bullmq";

import { ingestDocument } from "@/modules/documents/ingest-document";

import { isLastAttempt, type JobPayload } from "../context";

type IngestDocumentPayload = JobPayload & { uploadId: string };

export async function ingestDocumentJob(job: Job<JobPayload>): Promise<void> {
  const { orgId, uploadId } = job.data as IngestDocumentPayload;
  if (!uploadId) {
    throw new Error("ingest-document job payload missing uploadId");
  }
  await ingestDocument(orgId, uploadId, isLastAttempt(job));
}
