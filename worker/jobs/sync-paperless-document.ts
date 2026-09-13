import type { Job } from "bullmq";

import { syncPaperlessDocument } from "@/modules/documents/sync-paperless-document";

import { isLastAttempt, type JobPayload } from "../context";

type SyncPaperlessDocumentPayload = JobPayload & {
  paperlessDocumentId: number;
  uploadId?: string | null;
};

export async function syncPaperlessDocumentJob(job: Job<JobPayload>): Promise<void> {
  const { orgId, paperlessDocumentId, uploadId } = job.data as SyncPaperlessDocumentPayload;
  if (!paperlessDocumentId) {
    throw new Error("sync-paperless-document job payload missing paperlessDocumentId");
  }
  await syncPaperlessDocument(orgId, paperlessDocumentId, uploadId, isLastAttempt(job));
}
