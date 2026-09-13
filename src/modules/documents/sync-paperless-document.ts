import {
  getPaperlessCorrespondentName,
  getPaperlessDocument,
  getPaperlessDocumentTypeName,
  toDocumentTypeKey
} from "@/lib/paperless/documents";
import { logEvent } from "@/lib/events";
import { logger } from "@/lib/logger";
import { paperlessFor } from "@/lib/paperless/client";
import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/modules/notifications/notifications.service";

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
        ? getPaperlessDocumentTypeName(paperless, doc.document_type).then(toDocumentTypeKey)
        : Promise.resolve(null),
      doc.correspondent != null
        ? getPaperlessCorrespondentName(paperless, doc.correspondent)
        : Promise.resolve(null)
    ]);

    // page_count/mime_type/checksum confirmed live against the pinned instance
    // (src/lib/paperless/types.ts) — available for every caller, not just the upload path.
    // byte_size has no Paperless field anywhere (checked both list and detail shapes) — only
    // the upload path can fill it, from our own document_uploads row.
    const checksum =
      doc.versions.find((v) => v.is_root)?.checksum ?? doc.versions[0]?.checksum ?? null;

    let byteSize: number | null = null;
    let createdBy: string | null = null;

    if (uploadId) {
      const { data: upload, error: uploadError } = await db
        .from("document_uploads")
        .select("size_bytes, created_by")
        .eq("id", uploadId)
        .eq("organization_id", orgId)
        .single();
      if (uploadError) throw uploadError;
      byteSize = upload.size_bytes;
      createdBy = upload.created_by;
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
          byte_size: byteSize,
          mime_type: doc.mime_type,
          checksum,
          status: "ready",
          created_by: createdBy,
          synced_at: new Date().toISOString()
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

    // Rule engine evaluation isn't built yet (worker/registry.ts's runRule is still a
    // not-implemented placeholder) — this job's only responsibility is firing the trigger.
    await enqueue(QUEUE_NAMES.runRule, {
      orgId,
      documentId: documentRow.id,
      trigger: "document.ingested"
    });

    await logEvent({
      actorId: null,
      actorType: "system",
      action: "documents.ingested",
      entityType: "document",
      entityId: documentRow.id,
      organizationId: orgId,
      metadata: { paperlessDocumentId }
    });

    if (createdBy) {
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
