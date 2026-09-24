import { randomUUID } from "node:crypto";

import { getPaperlessDocument, toDocumentTypeKey } from "@/lib/paperless/documents";
import { getCachedCorrespondentName, getCachedDocumentTypeName } from "@/lib/paperless/metadata-cache";
import { logEvent } from "@/lib/events";
import { logger } from "@/lib/logger";
import { paperlessFor } from "@/lib/paperless/client";
import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import type { ServiceContext } from "@/lib/service-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/modules/notifications/notifications.service";
import { applyEntityLinks, applyFieldWrites, buildCustomFieldIdByKey } from "@/modules/imports/imports.apply";
import type { ResolvedEntityLink, ResolvedFieldWrite } from "@/modules/imports/imports.matching";

/**
 * specs/01-architecture.md §Upload steps 7-9, and the shared landing point for all three
 * document-ingestion paths (supabase/migrations/20260828000000_document_uploads.sql's comment):
 * the upload pipeline (submit-upload-to-paperless.ts, uploadId set), the Paperless post-consume
 * webhook (not yet built — will call this with just orgId+paperlessDocumentId), and the
 * reconciliation sweep (also not yet built — loops this over each missing document id, not a
 * batch payload; specs/01-architecture.md §Event bridge).
 *
 * Idempotent by upsert, not a claim step like validate-upload.ts/submit-upload-to-paperless.ts
 * — multiple callers can legitimately race to sync the same document (e.g. the webhook firing
 * while reconciliation is also running), and `documents`' own unique
 * (organization_id, paperless_document_id) constraint is what makes re-running this safe, not a
 * status-transition guard. isLastAttempt only gates the 'failed' write (cosmetic here, unlike
 * the other two jobs — there's no claim to strand, a retry just re-runs the whole thing).
 */
export async function syncPaperlessDocument(
  orgId: string,
  paperlessDocumentId: number,
  uploadId: string | null | undefined,
  isLastAttempt: boolean
): Promise<void> {
  const db = createAdminClient();

  try {
    const paperless = await paperlessFor(orgId);
    const doc = await getPaperlessDocument(paperless, paperlessDocumentId);

    const [documentTypeKey, correspondentName] = await Promise.all([
      doc.document_type != null
        ? getCachedDocumentTypeName(paperless, orgId, doc.document_type).then(toDocumentTypeKey)
        : Promise.resolve(null),
      doc.correspondent != null
        ? getCachedCorrespondentName(paperless, orgId, doc.correspondent)
        : Promise.resolve(null)
    ]);

    // page_count/mime_type/checksum confirmed live against the pinned instance
    // (src/lib/paperless/types.ts) — available for every caller, not just the upload path.
    // byte_size has no Paperless field anywhere (checked both list and detail shapes) — only
    // the upload path can fill it, from our own document_uploads row.
    const checksum =
      doc.versions.find((v) => v.is_root)?.checksum ?? doc.versions[0]?.checksum ?? null;

    // specs/07-rules-engine.md §Triggers: document.ingested fires when the mirror row is
    // created, document.updated when an existing row's type/date/custom field changed — this
    // upsert can't tell the two apart on its own, so the existing row (if any) is fetched first.
    const { data: existingRow, error: existingRowError } = await db
      .from("documents")
      .select("id, document_type_key, document_date")
      .eq("organization_id", orgId)
      .eq("paperless_document_id", paperlessDocumentId)
      .maybeSingle();
    if (existingRowError) throw existingRowError;

    let byteSize: number | null = null;
    let createdBy: string | null = null;
    // ADR-0019 Phase D — resolved client-side before the upload intent was created (see
    // resolveOrCreateFolderPathsAction/createUploadIntent); null for the flat upload flow, a
    // webhook/reconciliation resync (no uploadId), or an import row.
    let folderId: string | null = null;
    // Import-sourced uploads (document_uploads.import_row_id set) don't get a per-document
    // notification — a 10,000-document import would otherwise spam 10,000 of them. The import
    // job's own completion notification summarizes instead.
    let isFromImport = false;
    let importJobId: string | null = null;
    let pendingEntityLinks: ResolvedEntityLink[] = [];
    let pendingFieldWrites: ResolvedFieldWrite[] = [];

    if (uploadId) {
      const { data: upload, error: uploadError } = await db
        .from("document_uploads")
        .select("size_bytes, created_by, import_row_id, folder_id")
        .eq("id", uploadId)
        .eq("organization_id", orgId)
        .single();
      if (uploadError) throw uploadError;
      byteSize = upload.size_bytes;
      createdBy = upload.created_by;
      isFromImport = upload.import_row_id !== null;
      folderId = upload.folder_id;

      // A "documents" kind row (worker/modules/imports/run-import-chunk.ts's create_document
      // action) can't apply its entity links/field writes at chunk-processing time — the
      // document doesn't exist in our mirror until right now. Its plan was persisted onto the
      // row's own result for exactly this moment.
      if (upload.import_row_id !== null) {
        const { data: importRow, error: importRowError } = await db
          .from("import_rows")
          .select("import_job_id, result")
          .eq("id", upload.import_row_id)
          .eq("organization_id", orgId)
          .maybeSingle();
        if (importRowError) throw importRowError;
        if (importRow) {
          importJobId = importRow.import_job_id;
          const result = importRow.result as
            | { pendingEntityLinks?: ResolvedEntityLink[]; pendingFieldWrites?: ResolvedFieldWrite[] }
            | null;
          pendingEntityLinks = result?.pendingEntityLinks ?? [];
          pendingFieldWrites = result?.pendingFieldWrites ?? [];
        }
      }
    }

    const { data: documentRow, error: upsertError } = await db
      .from("documents")
      .upsert(
        {
          organization_id: orgId,
          paperless_document_id: paperlessDocumentId,
          title: doc.title,
          document_type_key: documentTypeKey,
          document_date: doc.created ? doc.created.slice(0, 10) : null,
          correspondent_name: correspondentName,
          page_count: doc.page_count,
          mime_type: doc.mime_type,
          checksum,
          status: "ready",
          synced_at: new Date().toISOString(),
          // Only our own upload row knows these. A resync from the webhook/reconciliation has no
          // upload, and sending nulls here would overwrite the real values on conflict — that is
          // how a document lost its creator (and with it, access) after any later resync. Omitted
          // columns are left untouched by the upsert.
          ...(uploadId
            ? {
                byte_size: byteSize,
                created_by: createdBy,
                source: isFromImport ? ("import" as const) : ("upload" as const),
                import_job_id: importJobId,
                // ADR-0019 Phase D — only ever set on first insert of a bulk-folder-uploaded
                // document; a later resync (webhook/reconciliation, uploadId null) never
                // overwrites a folder placement the user or a folder-match rule made since.
                folder_id: folderId
              }
            : {})
        },
        { onConflict: "organization_id,paperless_document_id" }
      )
      .select("id")
      .single();
    if (upsertError) throw upsertError;

    await upsertDocumentObjectMap(db, orgId, paperlessDocumentId, documentRow.id);

    if (uploadId) {
      const { error: completeError } = await db
        .from("document_uploads")
        .update({ status: "completed", document_id: documentRow.id })
        .eq("id", uploadId)
        .eq("organization_id", orgId);
      if (completeError) throw completeError;
    }

    if (pendingEntityLinks.length > 0 || pendingFieldWrites.length > 0) {
      // Best-effort, deliberately outside the main try/catch's retry semantics: the document
      // itself already synced successfully (documents.upsert above committed), so a failure
      // applying its import row's connections/field writes must never make this whole job
      // retry — a retry would just redundantly re-upsert an already-synced document. Logged
      // loudly instead; docs/PHASE3_HANDOFF.md documents this as the one known gap (no
      // automatic re-attempt for a deferred apply that fails, since retry-failed only
      // re-queues rows already at status='failed', and this row is already 'ok').
      try {
        const importCtx: ServiceContext = { db, orgId, actorId: null, correlationId: randomUUID() };
        const links =
          pendingEntityLinks.length > 0 ? await applyEntityLinks(importCtx, documentRow.id, pendingEntityLinks) : [];
        if (pendingFieldWrites.length > 0) {
          const customFieldIdByKey = await buildCustomFieldIdByKey(importCtx);
          await applyFieldWrites(importCtx, paperlessDocumentId, pendingFieldWrites, customFieldIdByKey);
        }
        logger.info("documents.sync.deferred_import_apply_completed", {
          orgId,
          documentId: documentRow.id,
          linkCount: links.length
        });
      } catch (err) {
        logger.error("documents.sync.deferred_import_apply_failed", {
          orgId,
          documentId: documentRow.id,
          errorMessage: err instanceof Error ? err.message : String(err)
        });
      }
    }

    const newDocumentDate = doc.created ? doc.created.slice(0, 10) : null;
    const isNew = !existingRow;
    const changed =
      !isNew &&
      (existingRow.document_type_key !== documentTypeKey || existingRow.document_date !== newDocumentDate);

    if (isNew || changed) {
      await enqueue(QUEUE_NAMES.runRule, {
        orgId,
        documentId: documentRow.id,
        trigger: isNew ? "document.ingested" : "document.updated"
      });
    }

    await logEvent({
      actorId: null,
      actorType: "system",
      action: "documents.ingested",
      entityType: "document",
      entityId: documentRow.id,
      organizationId: orgId,
      metadata: { paperlessDocumentId }
    });

    if (createdBy && !isFromImport) {
      await createNotification(createdBy, {
        type: "document.ingested",
        title: "Document ready",
        message: `"${doc.title}" has finished processing.`,
        metadata: { documentId: documentRow.id }
      });
    }

    logger.info("documents.sync.completed", {
      orgId,
      paperlessDocumentId,
      documentId: documentRow.id
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("documents.sync.failed", {
      orgId,
      paperlessDocumentId,
      uploadId,
      isLastAttempt,
      errorMessage: message
    });

    if (uploadId && isLastAttempt) {
      const { error: failError } = await db
        .from("document_uploads")
        .update({ status: "failed", error_message: message.slice(0, 500) })
        .eq("id", uploadId)
        .eq("organization_id", orgId);
      if (failError) {
        logger.error("documents.sync.fail_update_failed", {
          orgId,
          uploadId,
          errorMessage: failError.message
        });
      }
    }
    throw err;
  }
}

// The (object_type, paperless_id) unique constraint has no organization_id component
// (supabase/migrations/20260825000000_paperless_linkage.sql — deliberate, specs/02-data-
// model.md) — a conflict here would mean two different orgs' documents mapping to the same
// Paperless id, which should be structurally impossible under correct tenant isolation. Treat
// it as a loud failure, not something to silently paper over by reassigning the mapping.
// Exported for e2e/isolation.spec.ts's test #19 ("reconciliation sweep does not adopt B's
// documents") — the normal call path can't exercise this guard (Paperless's own ACL already
// stops org B from ever seeing org A's document, so the conflict path is only reachable by
// calling this directly with a paperless_id already claimed by another org).
export async function upsertDocumentObjectMap(
  db: ReturnType<typeof createAdminClient>,
  orgId: string,
  paperlessDocumentId: number,
  localId: string
): Promise<void> {
  const { error: insertError } = await db.from("paperless_object_map").insert({
    object_type: "document",
    paperless_id: paperlessDocumentId,
    organization_id: orgId,
    local_id: localId
  });

  if (!insertError) return;
  if (insertError.code !== "23505") throw insertError;

  const { data: existing, error: fetchError } = await db
    .from("paperless_object_map")
    .select("organization_id")
    .eq("object_type", "document")
    .eq("paperless_id", paperlessDocumentId)
    .single();
  if (fetchError) throw fetchError;

  if (existing.organization_id !== orgId) {
    throw new Error(
      `paperless_object_map conflict: document ${paperlessDocumentId} is already mapped to org ` +
        `${existing.organization_id}, not ${orgId}`
    );
  }

  const { error: updateError } = await db
    .from("paperless_object_map")
    .update({ local_id: localId })
    .eq("object_type", "document")
    .eq("paperless_id", paperlessDocumentId);
  if (updateError) throw updateError;
}
