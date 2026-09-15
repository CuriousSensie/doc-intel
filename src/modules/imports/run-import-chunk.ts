import { randomUUID } from "node:crypto";

import { documentsConfig } from "@/config/documents";
import { importsConfig } from "@/config/imports";
import { describeError } from "@/lib/errors";
import { getImportControl } from "@/lib/import/control";
import { openZipEntryStream, type ZipEntryInfo } from "@/lib/import/parse";
import { ImportRowError } from "@/lib/import/errors";
import { logger } from "@/lib/logger";
import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import { QUEUE_PRIORITY } from "@/lib/queue/config";
import type { ServiceContext } from "@/lib/service-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createEntity, updateEntity } from "@/modules/entities/entities.service";
import { createNotification } from "@/modules/notifications/notifications.service";
import type { Database, Json } from "@/types/database";

import { applyEntityLinks, applyFieldWrites, buildCustomFieldIdByKey } from "./imports.apply";
import { openJobArchive, type OpenedJobArchive } from "./imports.archive";
import {
  resolveDocumentRowPlans,
  resolveEntityRowPlans,
  type DocumentRowPlan,
  type EntityRowPlan,
  type RawImportRow
} from "./imports.matching";
import { mappingSchemaForKind, type DocumentImportMapping, type EntityImportMapping, type MetadataOnlyImportMapping } from "./imports.schemas";
import type { ImportJob, ImportRow } from "./imports.service";

type AdminDb = ReturnType<typeof createAdminClient>;
type ClaimedRow = Database["public"]["Tables"]["import_rows"]["Row"];

const MAX_ROW_ATTEMPTS = 3;

const EXTENSION_MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  tiff: "image/tiff",
  tif: "image/tiff",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  odt: "application/vnd.oasis.opendocument.text"
};

function guessMimeType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return EXTENSION_MIME_TYPES[ext] ?? "application/octet-stream";
}

type RowOutcome = {
  status: ImportRow["status"];
  result: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
};

async function fetchJob(admin: AdminDb, orgId: string, importJobId: string): Promise<ImportJob> {
  const { data, error } = await admin
    .from("import_jobs")
    .select("*")
    .eq("id", importJobId)
    .eq("organization_id", orgId)
    .single();
  if (error) throw error;
  return data;
}

async function claimChunk(admin: AdminDb, orgId: string, importJobId: string, limit: number): Promise<ClaimedRow[]> {
  const { data, error } = await admin.rpc("claim_import_chunk", {
    p_import_job_id: importJobId,
    p_organization_id: orgId,
    p_limit: limit
  });
  if (error) throw error;
  return data ?? [];
}

async function tryFinalize(admin: AdminDb, orgId: string, importJobId: string): Promise<void> {
  const { data: didComplete, error } = await admin.rpc("complete_import_job", {
    p_import_job_id: importJobId,
    p_organization_id: orgId
  });
  if (error) throw error;
  if (!didComplete) return;

  logger.info("imports.run_chunk.completed_job", { orgId, importJobId });

  // One summary notification for the whole job, never per-row (sync-paperless-document.ts
  // already suppresses the per-document notification for import-sourced uploads for exactly
  // this reason).
  const { data: job, error: jobError } = await admin
    .from("import_jobs")
    .select("created_by, source_filename, status, succeeded_rows, failed_rows, skipped_rows")
    .eq("id", importJobId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (jobError || !job?.created_by) return;

  await createNotification(job.created_by, {
    type: "import.completed",
    title: "Import finished",
    message: `"${job.source_filename ?? "Import"}" finished: ${job.succeeded_rows} ok, ${job.failed_rows} failed, ${job.skipped_rows} skipped.`,
    metadata: { importJobId, status: job.status }
  });
}

/**
 * Phase 3 M6: one job per *chunk* (specs/06-importer.md: "chunks of 50"), not per row —
 * claims up to importsConfig.chunkSize pending rows via claim_import_chunk() (the same
 * conditional-UPDATE-with-FOR-UPDATE-SKIP-LOCKED pattern as claim_upload_validation()/
 * claim_provisioning()), processes them, writes verdicts in one bulk_update_import_rows() call,
 * bumps import_jobs' counters atomically (increment_import_job_progress()), then re-enqueues
 * itself. A self-perpetuating chain, not a fixed worker pool, is what bounds "concurrency
 * configurable per org" (importsConfig.defaultConcurrencyPerOrganization): starting N chains at
 * startImportJob() keeps exactly N chunks in flight for that org at any time, no more.
 *
 * Reuses resolveEntityRowPlans()/resolveDocumentRowPlans() verbatim from validateImportJob() —
 * the only difference is this actually executes the plan instead of writing a dry-run verdict.
 * A plan validate() already called "ok" can still fail here (a real write can hit a real error
 * a read-only dry run never sees) — expected, not a bug in either step.
 *
 * A brand-new document ("documents" kind, matched by archive filename) can't have its entity
 * links/field writes applied yet — the document doesn't exist in our mirror until
 * sync-paperless-document.ts processes it, well after Paperless finishes consuming the file.
 * Those are persisted onto the row's own `result` (pendingEntityLinks/pendingFieldWrites) and
 * applied later by sync-paperless-document.ts once it knows document_uploads.import_row_id.
 * The row is still marked "ok" here — specs/06-importer.md: "Never block import completion on
 * OCR completion... connections and business data are available immediately" (relative to OCR,
 * not to this chunk finishing synchronously) — see docs/PHASE3_HANDOFF.md for the precise
 * eventual-consistency window this creates.
 */
export async function runImportChunk(orgId: string, importJobId: string): Promise<void> {
  const control = await getImportControl(importJobId);
  if (control !== "running") {
    logger.info("imports.run_chunk.stopped", { orgId, importJobId, control });
    return;
  }

  const admin = createAdminClient();
  const job = await fetchJob(admin, orgId, importJobId);

  const claimed = await claimChunk(admin, orgId, importJobId, importsConfig.chunkSize);
  if (claimed.length === 0) {
    await tryFinalize(admin, orgId, importJobId);
    return;
  }

  const ctx: ServiceContext = { db: admin, orgId, actorId: job.created_by, correlationId: randomUUID() };
  const schema = mappingSchemaForKind(job.kind);
  const mappingParsed = schema.safeParse(job.mapping);

  if (!mappingParsed.success) {
    // Shouldn't happen — validateImportJob() already checked this before the job could reach
    // "ready" — a structural failure, not a per-row one, so this fails the whole job and stops
    // the chain rather than rescheduling the next chunk into the same guaranteed failure.
    await bulkFail(admin, orgId, importJobId, claimed, "UNKNOWN", "Import mapping is invalid");
    await admin.rpc("fail_import_job", {
      p_import_job_id: importJobId,
      p_organization_id: orgId,
      p_reason: "Import mapping is invalid"
    });
    return;
  }

  const rows: RawImportRow[] = claimed.map((r) => ({ rowNumber: r.row_number, raw: r.raw as unknown as string[] }));
  let archive: OpenedJobArchive | null = null;

  try {
    if (job.kind === "documents") archive = await openJobArchive(job);

    const plans =
      job.kind === "entities"
        ? await resolveEntityRowPlans(ctx, mappingParsed.data as EntityImportMapping, rows)
        : await resolveDocumentRowPlans(ctx, job.kind, {
            mapping: mappingParsed.data as DocumentImportMapping | MetadataOnlyImportMapping,
            rows,
            archiveEntries: archive?.entries
          });

    const customFieldIdByKey = job.kind === "entities" ? new Map<string, number | null>() : await buildCustomFieldIdByKey(ctx);

    const rowUpdates: Array<{ id: number; status: string; result: Json; error_code: string | null; error_message: string | null }> = [];
    const retryRowIds: number[] = [];
    let succeededDelta = 0;
    let failedDelta = 0;
    let skippedDelta = 0;

    for (const claimedRow of claimed) {
      const plan = plans.get(claimedRow.row_number);
      try {
        const outcome = await executeRowPlan(
          ctx,
          job,
          plan,
          claimedRow.id,
          archive?.tempFile.path,
          archive?.entries,
          customFieldIdByKey
        );
        rowUpdates.push({
          id: claimedRow.id,
          status: outcome.status,
          result: outcome.result as Json,
          error_code: outcome.errorCode ?? null,
          error_message: outcome.errorMessage ?? null
        });
        if (outcome.status === "ok") succeededDelta++;
        else if (outcome.status === "skipped_duplicate") skippedDelta++;
        else failedDelta++;
      } catch (err) {
        if (claimedRow.attempts + 1 < MAX_ROW_ATTEMPTS) {
          retryRowIds.push(claimedRow.id);
          logger.info("imports.run_chunk.row_retrying", {
            orgId,
            importJobId,
            rowId: claimedRow.id,
            attempts: claimedRow.attempts + 1,
            errorMessage: describeError(err)
          });
        } else {
          rowUpdates.push({
            id: claimedRow.id,
            status: "failed",
            result: {} as Json,
            error_code: "PAPERLESS_ERROR",
            error_message: describeError(err).slice(0, 500)
          });
          failedDelta++;
        }
      }
    }

    if (rowUpdates.length > 0) {
      const { error } = await admin.rpc("bulk_update_import_rows", {
        p_import_job_id: importJobId,
        p_organization_id: orgId,
        p_rows: rowUpdates as unknown as Json
      });
      if (error) throw error;
    }

    // Transient failures: bump attempts, revert to pending so a later claim can retry — not
    // part of the bulk verdict write above (still no final status), so a plain per-row update
    // (a handful at most; the common case is zero).
    for (const rowId of retryRowIds) {
      const row = claimed.find((r) => r.id === rowId);
      const { error } = await admin
        .from("import_rows")
        .update({ status: "pending", attempts: (row?.attempts ?? 0) + 1 })
        .eq("id", rowId);
      if (error) throw error;
    }

    if (rowUpdates.length > 0) {
      const { error } = await admin.rpc("increment_import_job_progress", {
        p_import_job_id: importJobId,
        p_organization_id: orgId,
        p_processed_delta: rowUpdates.length,
        p_succeeded_delta: succeededDelta,
        p_failed_delta: failedDelta,
        p_skipped_delta: skippedDelta
      });
      if (error) throw error;
    }

    logger.info("imports.run_chunk.processed", {
      orgId,
      importJobId,
      claimed: claimed.length,
      succeeded: succeededDelta,
      failed: failedDelta,
      skipped: skippedDelta,
      retrying: retryRowIds.length
    });
  } finally {
    if (archive) await archive.tempFile.cleanup();
  }

  await rescheduleIfRunning(orgId, importJobId);
}

async function rescheduleIfRunning(orgId: string, importJobId: string): Promise<void> {
  const control = await getImportControl(importJobId);
  if (control === "running") {
    await enqueue(
      QUEUE_NAMES.runImportChunk,
      { orgId, importJobId },
      { priority: QUEUE_PRIORITY.importRow }
    );
  }
}

async function bulkFail(
  admin: AdminDb,
  orgId: string,
  importJobId: string,
  rows: ClaimedRow[],
  code: string,
  message: string
): Promise<void> {
  const { error } = await admin.rpc("bulk_update_import_rows", {
    p_import_job_id: importJobId,
    p_organization_id: orgId,
    p_rows: rows.map((r) => ({ id: r.id, status: "failed", result: {}, error_code: code, error_message: message })) as unknown as Json
  });
  if (error) throw error;

  await admin.rpc("increment_import_job_progress", {
    p_import_job_id: importJobId,
    p_organization_id: orgId,
    p_processed_delta: rows.length,
    p_succeeded_delta: 0,
    p_failed_delta: rows.length,
    p_skipped_delta: 0
  });
}

async function executeRowPlan(
  ctx: ServiceContext,
  job: ImportJob,
  plan: EntityRowPlan | DocumentRowPlan | undefined,
  rowId: number,
  archivePath: string | undefined,
  archiveEntries: ZipEntryInfo[] | undefined,
  customFieldIdByKey: Map<string, number | null>
): Promise<RowOutcome> {
  if (!plan) {
    return { status: "failed", result: {}, errorCode: "UNKNOWN", errorMessage: "No plan resolved for this row" };
  }

  if (plan.action === "error") {
    const needsReviewCodes = ["IDENTIFIER_CONFLICT", "DUPLICATE"];
    return {
      status: needsReviewCodes.includes(plan.code) ? "needs_review" : "failed",
      result: {},
      errorCode: plan.code,
      errorMessage: plan.message
    };
  }

  if (plan.action === "create" || plan.action === "update") {
    const entity =
      plan.action === "create"
        ? await createEntity(ctx, { entityTypeId: plan.entityTypeId, displayName: plan.displayName, data: plan.data })
        : await updateEntity(ctx, plan.entityId, { displayName: plan.displayName, data: plan.data });
    return { status: "ok", result: { entityId: entity.id, action: plan.action } };
  }

  if (plan.action === "skip_duplicate") {
    const links = await applyEntityLinks(ctx, plan.documentId, plan.entityLinks);
    return { status: "skipped_duplicate", result: { documentId: plan.documentId, links } };
  }

  if (plan.action === "connect_existing") {
    const links = await applyEntityLinks(ctx, plan.documentId, plan.entityLinks);
    await applyFieldWrites(ctx, plan.paperlessDocumentId, plan.fieldWrites, customFieldIdByKey);
    return { status: "ok", result: { documentId: plan.documentId, links } };
  }

  // plan.action === "create_document"
  if (!archivePath) {
    return { status: "failed", result: {}, errorCode: "UNKNOWN", errorMessage: "Archive not available for this row" };
  }

  const uploadId = await createDocumentUploadFromArchiveEntry(
    ctx,
    job,
    rowId,
    archivePath,
    plan.archiveFileName,
    archiveEntries
  );

  return {
    status: "ok",
    result: {
      uploadId,
      ingestPending: true,
      pendingEntityLinks: plan.entityLinks,
      pendingFieldWrites: plan.fieldWrites
    }
  };
}

async function createDocumentUploadFromArchiveEntry(
  ctx: ServiceContext,
  job: ImportJob,
  rowId: number,
  archivePath: string,
  fileName: string,
  archiveEntries: ZipEntryInfo[] | undefined
): Promise<string> {
  const entry = archiveEntries?.find((e) => e.fileName === fileName);
  const stream = await openZipEntryStream(archivePath, fileName);

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    totalBytes += chunk.length;
    if (totalBytes > documentsConfig.maxSizeBytes) {
      throw new ImportRowError("PARSE_ERROR", `"${fileName}" exceeds the maximum upload size`);
    }
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);

  const displayName = fileName.split("/").pop() ?? fileName;
  const storagePath = `${ctx.orgId}/${randomUUID()}-${displayName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const mimeType = guessMimeType(displayName);

  const { error: uploadError } = await ctx.db.storage
    .from(documentsConfig.bucket)
    .upload(storagePath, buffer, { contentType: mimeType });
  if (uploadError) throw uploadError;

  const { data: uploadRow, error: insertError } = await ctx.db
    .from("document_uploads")
    .insert({
      organization_id: ctx.orgId,
      storage_path: storagePath,
      filename: displayName,
      declared_mime_type: mimeType,
      size_bytes: entry?.uncompressedSize ?? buffer.length,
      status: "uploaded",
      created_by: job.created_by,
      import_row_id: rowId,
      // Import-linked rows are excluded from expire-abandoned-uploads.ts's sweep entirely
      // (Phase 3 M3) — this value is never actually consulted for them, kept generous anyway.
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    })
    .select("id")
    .single();
  if (insertError) throw insertError;

  await enqueue(
    QUEUE_NAMES.ingestDocument,
    { orgId: ctx.orgId, uploadId: uploadRow.id },
    { priority: QUEUE_PRIORITY.importRow }
  );

  return uploadRow.id;
}
