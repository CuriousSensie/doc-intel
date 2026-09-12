import { documentsConfig } from "@/config/documents";
import { UnprocessableError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { paperlessFor } from "@/lib/paperless/client";
import { parsePostDocumentTaskId, pollPaperlessTask } from "@/lib/paperless/tasks";
import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import { createAdminClient } from "@/lib/supabase/admin";

const ACTIVE_STATUSES = ["validated", "submitting", "processing"];

/**
 * specs/01-architecture.md §Upload steps 4-6: streams the file from storage, POSTs it to
 * Paperless as the tenant's own service user (never the superuser — paperlessFor()), persists
 * the returned task id immediately (the resumability point below), then polls until Paperless
 * finishes consuming it. Creating the `documents` mirror row (step 7) is
 * sync-paperless-document.ts's job, not this one (see 20260828000000_document_uploads.sql's
 * comment) — this job hands off by enqueuing it once Paperless has a document id.
 *
 * Resumability: unlike validate-upload.ts's single atomic RPC claim, this job's real work
 * (multipart upload, then a ~minute-long poll) can be interrupted anywhere, so there's no one
 * claim step — `paperless_task_id` on the row IS the checkpoint. A retry that finds it already
 * set skips straight to polling instead of re-POSTing the file (post_document/ is not
 * idempotent — a second POST would create a duplicate document).
 */
export async function submitUploadToPaperless(orgId: string, uploadId: string): Promise<void> {
  const db = createAdminClient();

  const { data: upload, error: fetchError } = await db
    .from("document_uploads")
    .select("status, storage_path, filename, paperless_task_id")
    .eq("id", uploadId)
    .eq("organization_id", orgId)
    .single();
  if (fetchError) throw fetchError;

  if (!ACTIVE_STATUSES.includes(upload.status)) {
    logger.info("documents.submit_upload.skipped_not_active", {
      orgId,
      uploadId,
      status: upload.status
    });
    return;
  }

  try {
    const paperless = await paperlessFor(orgId);
    let taskId = upload.paperless_task_id;

    if (!taskId) {
      // Conditional claim: only the caller that flips validated -> submitting proceeds to
      // POST. A concurrent duplicate job that loses this race returns early rather than
      // re-uploading — the winner (or a later retry, once paperless_task_id is set) carries on.
      const { data: claimedRows, error: claimError } = await db
        .from("document_uploads")
        .update({ status: "submitting" })
        .eq("id", uploadId)
        .eq("organization_id", orgId)
        .eq("status", "validated")
        .select("id");
      if (claimError) throw claimError;
      if (!claimedRows?.length) {
        logger.info("documents.submit_upload.lost_claim_race", { orgId, uploadId });
        return;
      }

      const { data: file, error: downloadError } = await db.storage
        .from(documentsConfig.bucket)
        .download(upload.storage_path);
      if (downloadError) throw downloadError;

      const form = new FormData();
      form.append("document", new Blob([await file.arrayBuffer()]), upload.filename);
      form.append("title", upload.filename);

      const rawTaskId = await paperless.postForm<string>("/api/documents/post_document/", form);
      taskId = parsePostDocumentTaskId(rawTaskId);

      const { error: persistError } = await db
        .from("document_uploads")
        .update({ paperless_task_id: taskId, status: "processing" })
        .eq("id", uploadId)
        .eq("organization_id", orgId);
      if (persistError) throw persistError;
    }

    const task = await pollPaperlessTask(paperless, taskId);
    if (!task) {
      // Still processing after the poll budget — not a failure. Re-enqueuing lets a later
      // attempt resume polling against the same taskId without re-uploading.
      logger.info("documents.submit_upload.poll_timed_out", { orgId, uploadId, taskId });
      await enqueue(QUEUE_NAMES.submitUploadToPaperless, { orgId, uploadId });
      return;
    }

    if (task.status === "failure") {
      throw new UnprocessableError(
        `Paperless failed to ingest the document: ${task.result ?? "unknown error"}`
      );
    }

    const paperlessDocumentId = task.related_document_ids?.[0];
    if (!paperlessDocumentId) {
      throw new Error(`Paperless task ${taskId} succeeded with no related_document_ids`);
    }

    // P1-critical: post_document/ does not itself grant the tenant group view/change on the
    // resulting document (docs/spike-findings.md) — without this PATCH the document would be
    // readable only by the service user, or worse, fall back to whatever default ACL Paperless
    // applies, neither of which is the tenant-group-scoped grant D2's isolation model requires.
    const ownership = paperless.ownership;
    if (ownership) {
      await paperless.setOwnedObjectPermissions(
        `/api/documents/${paperlessDocumentId}/`,
        ownership
      );
    }

    await enqueue(QUEUE_NAMES.syncPaperlessDocument, { orgId, uploadId, paperlessDocumentId });

    logger.info("documents.submit_upload.completed", { orgId, uploadId, paperlessDocumentId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("documents.submit_upload.failed", { orgId, uploadId, errorMessage: message });

    const { error: failError } = await db
      .from("document_uploads")
      .update({ status: "failed", error_message: message.slice(0, 500) })
      .eq("id", uploadId)
      .eq("organization_id", orgId);
    if (failError) {
      logger.error("documents.submit_upload.fail_update_failed", {
        orgId,
        uploadId,
        errorMessage: failError.message
      });
    }
    throw err;
  }
}
