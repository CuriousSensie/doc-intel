import { logger } from "@/lib/logger";
import { paperlessFor, type PaperlessClient } from "@/lib/paperless/client";
import type { PaperlessListEnvelope, PaperlessTask } from "@/lib/paperless/types";
import {
  listOrgsWithPendingPaperlessTasks,
  listPendingPaperlessTasks,
  untrackPaperlessTasks,
  type TrackedPaperlessTask
} from "@/lib/paperless/task-tracker";
import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import { QUEUE_PRIORITY } from "@/lib/queue/config";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

// Safety net for a task that never resolves — Paperless never OCR/consumes it, or the pinned
// image's known all-in-one/worker-split gap (docs/spike-findings.md §0) genuinely wedges it.
// Unlike a resolved document, reconciliation cannot rescue this: reconciliation diffs
// Paperless's own document listing against our mirror, and a task that never produced a
// document has nothing there to diff. So this marks the upload row failed with an honest
// message rather than silently dropping tracking and hoping something else notices.
const STALE_TASK_MS = 15 * 60 * 1000;

// Bounds one org's per-tick Paperless-call footprint so a large in-flight backlog for one
// tenant (a bulk import in flight) can't crowd out that same tenant's own interactive
// paperless:read budget — see docs/adr/0014-paperless-task-poller-isolation.md. Unresolved
// tasks beyond this cap are simply picked up again next tick; nothing is lost by deferring.
const MAX_TASKS_PER_ORG_PER_TICK = 25;

/**
 * Phase 3 M3: resolves Paperless task ids that ingest-document.ts submitted but stopped
 * waiting on synchronously. Runs every 2s (worker/index.ts's JobScheduler), decoupled from
 * ingest worker concurrency entirely — this is a latency/failure-detection optimization, not
 * a correctness path. The webhook (document-consumed) already delivers the fast, correctly-
 * scoped success signal for most documents; reconciliation is still the correctness backstop
 * for anything both this poller and the webhook miss. What only this poller provides is fast
 * *failure* detection — Paperless's post-consume script never fires on a failed task, so
 * without this, a failed submission would sit at document_uploads.status='processing' forever.
 *
 * One job that loops over every org with pending tasks internally (same shape as
 * reconcile-incremental.ts) — a single org's failure is logged and skipped, never aborting the
 * rest of the tick.
 */
export async function pollPaperlessTasks(): Promise<void> {
  const orgIds = await listOrgsWithPendingPaperlessTasks();

  for (const orgId of orgIds) {
    try {
      await pollOrgPaperlessTasks(orgId);
    } catch (err) {
      logger.error("documents.poll_tasks.org_failed", {
        orgId,
        errorMessage: err instanceof Error ? err.message : String(err)
      });
    }
  }
}

async function pollOrgPaperlessTasks(orgId: string): Promise<void> {
  const db = createAdminClient();
  const pending = await listPendingPaperlessTasks(orgId);
  if (pending.size === 0) return;

  const paperless = await paperlessFor(orgId);
  const resolvedTaskIds: string[] = [];
  const now = Date.now();

  const entries = [...pending.entries()].slice(0, MAX_TASKS_PER_ORG_PER_TICK);

  for (const [taskId, tracked] of entries) {
    // Never the unfiltered GET /api/tasks/ — confirmed live (ADR-0014) that it returns every
    // tenant's tasks, not just this one's. This filtered form is confirmed correctly scoped.
    const envelope = await paperless.get<PaperlessListEnvelope<PaperlessTask>>(
      `/api/tasks/?task_id=${encodeURIComponent(taskId)}`
    );
    const task = envelope.results[0];

    if (task?.status === "success" || task?.status === "failure") {
      resolvedTaskIds.push(taskId);
      await handleResolvedTask(db, paperless, orgId, taskId, tracked, task);
      continue;
    }

    if (now - tracked.submittedAt > STALE_TASK_MS) {
      resolvedTaskIds.push(taskId);
      await failStaleUpload(db, orgId, taskId, tracked);
    }
  }

  await untrackPaperlessTasks(orgId, resolvedTaskIds);
}

async function handleResolvedTask(
  db: AdminClient,
  paperless: PaperlessClient,
  orgId: string,
  taskId: string,
  tracked: TrackedPaperlessTask,
  task: PaperlessTask
): Promise<void> {
  if (task.status === "failure") {
    await failUpload(
      db,
      orgId,
      tracked.uploadId,
      `Paperless failed to ingest the document: ${describeTaskResult(task)}`
    );
    logger.info("documents.poll_tasks.task_failed", { orgId, taskId });
    return;
  }

  const paperlessDocumentId = task.related_document_ids?.[0];
  if (!paperlessDocumentId) {
    await failUpload(
      db,
      orgId,
      tracked.uploadId,
      `Paperless task ${taskId} succeeded with no related_document_ids`
    );
    return;
  }

  // P1-critical: post_document/ does not itself grant the tenant group view/change on the
  // resulting document (docs/spike-findings.md) — the same PATCH submit-upload-to-paperless.ts
  // always applied inline, now applied here since this is where task success is discovered.
  if (paperless.ownership) {
    await paperless.setOwnedObjectPermissions(
      `/api/documents/${paperlessDocumentId}/`,
      paperless.ownership
    );
  }

  await enqueue(
    QUEUE_NAMES.syncPaperlessDocument,
    { orgId, uploadId: tracked.uploadId ?? undefined, paperlessDocumentId },
    { priority: QUEUE_PRIORITY.interactiveUpload }
  );

  logger.info("documents.poll_tasks.task_succeeded", { orgId, taskId, paperlessDocumentId });
}

function describeTaskResult(task: PaperlessTask): string {
  if (task.result_data === undefined || task.result_data === null) return "unknown error";
  if (typeof task.result_data === "string") return task.result_data;
  try {
    return JSON.stringify(task.result_data);
  } catch {
    return "unknown error";
  }
}

async function failStaleUpload(
  db: AdminClient,
  orgId: string,
  taskId: string,
  tracked: TrackedPaperlessTask
): Promise<void> {
  logger.error("documents.poll_tasks.task_stale", { orgId, taskId, uploadId: tracked.uploadId });
  await failUpload(
    db,
    orgId,
    tracked.uploadId,
    `Paperless did not report completion for task ${taskId} within the expected window`
  );
}

async function failUpload(
  db: AdminClient,
  orgId: string,
  uploadId: string | null,
  message: string
): Promise<void> {
  if (!uploadId) return;

  const { error } = await db
    .from("document_uploads")
    // Only overwrite rows still mid-flight — never clobber a status this same tick's own
    // enqueue of sync-paperless-document may have already advanced past processing.
    .update({ status: "failed", error_message: message.slice(0, 500) })
    .eq("id", uploadId)
    .eq("organization_id", orgId)
    .in("status", ["processing"]);

  if (error) {
    logger.error("documents.poll_tasks.fail_update_failed", {
      orgId,
      uploadId,
      errorMessage: error.message
    });
  }
}
