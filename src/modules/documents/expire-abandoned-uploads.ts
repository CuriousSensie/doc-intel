import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * supabase/migrations/20260828000000_document_uploads.sql's `document_uploads_expiry_idx`
 * sweep target. Global across every tenant, not scoped to one org — a browser abandoning an
 * upload mid-flow (closed tab, presigned URL expired, upload-complete never called) leaves a
 * `document_uploads` row stuck at `pending`/`uploaded` forever with nothing else to move it
 * out of that state, so this just flips anything past its own `expires_at` to `expired`.
 *
 * Excludes import-sourced rows (`import_row_id` set — Phase 3's chunked import execution,
 * M6): those aren't an abandoned browser upload, they're an in-progress import job that can
 * legitimately sit at `pending`/`uploaded` for longer than `documentsConfig.pendingExpiryMinutes`
 * while its own chunk backlog works through, and their lifecycle belongs to the import job
 * (pause/resume/cancel), not to this sweep. Found reading this code before the importer
 * existed: without this exclusion, a large import's own staged rows would be silently expired
 * out from under it.
 */
export async function expireAbandonedUploads(): Promise<number> {
  const db = createAdminClient();

  const { data, error } = await db
    .from("document_uploads")
    .update({ status: "expired" })
    .in("status", ["pending", "uploaded"])
    .is("import_row_id", null)
    .lt("expires_at", new Date().toISOString())
    .select("id");
  if (error) throw error;

  const count = data?.length ?? 0;
  logger.info("documents.expire_abandoned.completed", { count });
  return count;
}
