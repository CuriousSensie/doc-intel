import { documentsConfig } from "@/config/documents";
import { ValidationError } from "@/lib/errors";
import { scanBuffer } from "@/lib/files/scan";
import { validateFileAgainstConfig } from "@/lib/files/validate";
import { logger } from "@/lib/logger";
import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * specs/10-nonfunctional.md §Security: MIME re-sniff (not extension trust), size cap, and
 * allowlist, then an AV scan — all before submit-upload-to-paperless.ts hands the file to
 * Paperless.
 *
 * Concurrency: claimed via a conditional UPDATE (uploaded -> validating), same rationale as
 * provisionTenant() (src/modules/tenants/provision-tenant.ts) — the real work (storage
 * download, AV scan) spans round-trips a session-scoped advisory lock wouldn't cover.
 */
export async function validateUpload(orgId: string, uploadId: string): Promise<void> {
  const db = createAdminClient();

  const { data: claimed, error: claimError } = await db.rpc("claim_upload_validation", {
    p_upload_id: uploadId,
    p_organization_id: orgId
  });
  if (claimError) throw claimError;
  if (!claimed) {
    logger.info("documents.validate_upload.skipped_not_claimable", { orgId, uploadId });
    return;
  }

  try {
    const { data: upload, error: fetchError } = await db
      .from("document_uploads")
      .select("storage_path, declared_mime_type, size_bytes")
      .eq("id", uploadId)
      .eq("organization_id", orgId)
      .single();
    if (fetchError) throw fetchError;

    const { data: file, error: downloadError } = await db.storage
      .from(documentsConfig.bucket)
      .download(upload.storage_path);
    if (downloadError) throw downloadError;

    const buffer = Buffer.from(await file.arrayBuffer());

    validateFileAgainstConfig(
      { buffer, declaredMimeType: upload.declared_mime_type, size: upload.size_bytes },
      documentsConfig
    );

    const scanResult = await scanBuffer(buffer);
    if (scanResult.infected) {
      throw new ValidationError(`File failed antivirus scan: ${scanResult.signature ?? "unknown"}`);
    }

    const { error: completeError } = await db.rpc("complete_upload_validation", {
      p_upload_id: uploadId,
      p_organization_id: orgId
    });
    if (completeError) throw completeError;

    await enqueue(QUEUE_NAMES.submitUploadToPaperless, { orgId, uploadId });

    logger.info("documents.validate_upload.completed", { orgId, uploadId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("documents.validate_upload.failed", { orgId, uploadId, errorMessage: message });

    const { error: failError } = await db.rpc("fail_upload_validation", {
      p_upload_id: uploadId,
      p_organization_id: orgId,
      p_reason: message.slice(0, 500)
    });
    if (failError) {
      logger.error("documents.validate_upload.fail_rpc_failed", {
        orgId,
        uploadId,
        errorMessage: failError.message
      });
    }
    throw err;
  }
}
