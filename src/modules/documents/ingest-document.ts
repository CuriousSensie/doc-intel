import { createReadStream, openAsBlob } from "node:fs";
import { open } from "node:fs/promises";

import { documentsConfig } from "@/config/documents";
import { ValidationError } from "@/lib/errors";
import { scanStream } from "@/lib/files/scan";
import { validateFileAgainstConfig } from "@/lib/files/validate";
import { logger } from "@/lib/logger";
import { paperlessFor } from "@/lib/paperless/client";
import { parsePostDocumentTaskId } from "@/lib/paperless/tasks";
import { trackPendingPaperlessTask } from "@/lib/paperless/task-tracker";
import { createAdminClient } from "@/lib/supabase/admin";
import { downloadStorageObjectToTempFile } from "@/lib/supabase/storage-stream";

type AdminDb = ReturnType<typeof createAdminClient>;

type UploadRow = {
  status: string;
  storage_path: string;
  filename: string;
  declared_mime_type: string;
  size_bytes: number;
  paperless_task_id: string | null;
};

// Enough to cover every signature validateFileAgainstConfig()/sniffMimeType() checks (the
// longest is the 12-byte RIFF/WEBP probe) — this is a head-read, not the whole file.
const MIME_SNIFF_HEAD_BYTES = 64;

const TERMINAL_STATUSES = new Set(["completed", "failed"]);
// A prior attempt already reached (or is retrying) the submit step — resume from there instead
// of reclaiming the validation step, same set submit-upload-to-paperless.ts used as
// ACTIVE_STATUSES before the merge.
const RESUMABLE_AFTER_VALIDATION = new Set(["validated", "submitting", "processing"]);

async function readFileHead(path: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Phase 3 M3: merges the former validate-upload.ts + submit-upload-to-paperless.ts into one
 * job. This removes a queue hop, and — combined with streaming instead of buffering
 * (downloadStorageObjectToTempFile(), scanStream()) — removes the double download of the same
 * file that the two-job version paid (each job downloaded the object from storage separately).
 *
 * What it does NOT do anymore: block waiting for Paperless to finish consuming the document.
 * The old submit-upload-to-paperless.ts called pollPaperlessTask() synchronously (up to ~60s),
 * occupying a worker slot the whole time — the single biggest throughput ceiling for a bulk
 * import (docs/IMPLEMENTATION_PLAN.md's Phase 3 plan). Once post_document/ returns a task id,
 * this job just tracks it (trackPendingPaperlessTask()) and returns; poll-paperless-tasks.ts
 * resolves it on its own schedule, and the ingest worker is immediately free for the next
 * document. See docs/adr/0014-paperless-task-poller-isolation.md for why that poller can't
 * just batch one GET /api/tasks/ per org (unfiltered listing is not tenant-scoped — a real,
 * live-verified isolation gap, not a hypothetical).
 *
 * Resumability: three claim points, same shape as the two-job version had —
 * claim_upload_validation() (uploaded|validating -> validating) covers the file-in-hand work;
 * a conditional UPDATE (validated|submitting -> submitting) covers the POST to Paperless
 * (non-idempotent — a second POST would create a duplicate document, so `paperless_task_id`
 * being already set is itself the checkpoint that skips straight to tracking). A retry that
 * lands after this job already reached `processing` just re-tracks the task id (idempotent,
 * a Redis HSET) rather than doing nothing — the original two-job version could silently strand
 * a row here if a crash landed between setting paperless_task_id and enqueuing the next job;
 * this version can't, because "ensure it's tracked" is the terminal step of every code path.
 */
export async function ingestDocument(
  orgId: string,
  uploadId: string,
  isLastAttempt: boolean
): Promise<void> {
  const db = createAdminClient();

  const { data: upload, error: fetchError } = await db
    .from("document_uploads")
    .select("status, storage_path, filename, declared_mime_type, size_bytes, paperless_task_id")
    .eq("id", uploadId)
    .eq("organization_id", orgId)
    .single();
  if (fetchError) throw fetchError;

  if (TERMINAL_STATUSES.has(upload.status)) {
    logger.info("documents.ingest.skipped_terminal", { orgId, uploadId, status: upload.status });
    return;
  }

  try {
    if (upload.paperless_task_id) {
      // Already submitted (this attempt or an earlier one that crashed after persisting the
      // task id but before tracking it) — never re-POST, just (re-)ensure it's tracked.
      await trackPendingPaperlessTask(orgId, upload.paperless_task_id, uploadId);
      logger.info("documents.ingest.retracked", { orgId, uploadId, taskId: upload.paperless_task_id });
      return;
    }

    if (RESUMABLE_AFTER_VALIDATION.has(upload.status)) {
      await submitToPaperless(db, orgId, uploadId, upload);
      logger.info("documents.ingest.completed", { orgId, uploadId });
      return;
    }

    // pending/uploaded/validating — full validate-then-submit path.
    const { data: claimed, error: claimError } = await db.rpc("claim_upload_validation", {
      p_upload_id: uploadId,
      p_organization_id: orgId
    });
    if (claimError) throw claimError;
    if (!claimed) {
      logger.info("documents.ingest.skipped_not_claimable", { orgId, uploadId });
      return;
    }

    const temp = await downloadStorageObjectToTempFile(documentsConfig.bucket, upload.storage_path);
    try {
      const headBuffer = await readFileHead(temp.path, MIME_SNIFF_HEAD_BYTES);
      validateFileAgainstConfig(
        { buffer: headBuffer, declaredMimeType: upload.declared_mime_type, size: upload.size_bytes },
        documentsConfig
      );

      const scanResult = await scanStream(createReadStream(temp.path));
      if (scanResult.infected) {
        throw new ValidationError(
          `File failed antivirus scan: ${scanResult.signature ?? "unknown"}`
        );
      }

      const { error: completeError } = await db.rpc("complete_upload_validation", {
        p_upload_id: uploadId,
        p_organization_id: orgId
      });
      if (completeError) throw completeError;

      await submitToPaperless(db, orgId, uploadId, upload, temp.path);
    } finally {
      await temp.cleanup();
    }

    logger.info("documents.ingest.completed", { orgId, uploadId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("documents.ingest.failed", {
      orgId,
      uploadId,
      isLastAttempt,
      errorMessage: message
    });

    if (isLastAttempt) {
      const { error: failError } = await db
        .from("document_uploads")
        .update({ status: "failed", error_message: message.slice(0, 500) })
        .eq("id", uploadId)
        .eq("organization_id", orgId);
      if (failError) {
        logger.error("documents.ingest.fail_update_failed", {
          orgId,
          uploadId,
          errorMessage: failError.message
        });
      }
    }
    throw err;
  }
}

// Handles both the normal path (existingTempPath already holds the downloaded file, reused
// from validation — no second download) and the resume-after-crash path (validated in an
// earlier attempt, this process has no temp file, downloads once here).
async function submitToPaperless(
  db: AdminDb,
  orgId: string,
  uploadId: string,
  upload: Pick<UploadRow, "filename" | "declared_mime_type" | "storage_path">,
  existingTempPath?: string
): Promise<void> {
  // Conditional claim: only the caller that flips validated -> submitting proceeds to POST. A
  // concurrent duplicate job that loses this race returns early rather than re-uploading.
  const { data: claimedRows, error: claimError } = await db
    .from("document_uploads")
    .update({ status: "submitting" })
    .eq("id", uploadId)
    .eq("organization_id", orgId)
    .in("status", ["validated", "submitting"])
    .select("id");
  if (claimError) throw claimError;
  if (!claimedRows?.length) {
    logger.info("documents.ingest.lost_submit_claim_race", { orgId, uploadId });
    return;
  }

  const paperless = await paperlessFor(orgId);

  let filePath: string;
  let temp: Awaited<ReturnType<typeof downloadStorageObjectToTempFile>> | null = null;
  if (existingTempPath) {
    filePath = existingTempPath;
  } else {
    temp = await downloadStorageObjectToTempFile(documentsConfig.bucket, upload.storage_path);
    filePath = temp.path;
  }

  try {
    // fs.openAsBlob() backs the Blob by the file on disk rather than reading it into memory —
    // the multipart body streams straight from there, same reasoning as the download side.
    const fileBlob = await openAsBlob(filePath, { type: upload.declared_mime_type });
    const form = new FormData();
    form.append("document", fileBlob, upload.filename);
    form.append("title", upload.filename);

    const rawTaskId = await paperless.postForm<string>("/api/documents/post_document/", form);
    const taskId = parsePostDocumentTaskId(rawTaskId);

    const { error: persistError } = await db
      .from("document_uploads")
      .update({ paperless_task_id: taskId, status: "processing" })
      .eq("id", uploadId)
      .eq("organization_id", orgId);
    if (persistError) throw persistError;

    await trackPendingPaperlessTask(orgId, taskId, uploadId);
  } finally {
    if (temp) await temp.cleanup();
  }
}
