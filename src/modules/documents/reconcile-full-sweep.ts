import { logger } from "@/lib/logger";
import { paperlessFor } from "@/lib/paperless/client";
import { listAllPaperlessDocumentIds } from "@/lib/paperless/documents";
import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * specs/01-architecture.md §Event bridge, secondary path — the *complete* half of
 * reconciliation, run daily rather than every 5 minutes because it lists every document a
 * tenant has in Paperless (not just an added/modified-since window), which is the only way to
 * ever detect a Paperless-side deletion: reconcile-incremental.ts's filtered query structurally
 * can't prove a document is *gone*, only that nothing changed inside its window.
 *
 * Same shape as reconcile-incremental.ts: one job looping over every ready tenant internally,
 * a single tenant's failure logged and skipped rather than aborting the rest.
 */
export async function reconcileFullSweep(): Promise<void> {
  const db = createAdminClient();

  const { data: orgs, error } = await db
    .from("organizations")
    .select("id")
    .eq("provisioning_status", "ready");
  if (error) throw error;

  for (const org of orgs ?? []) {
    try {
      await reconcileTenantFullSweep(db, org.id);
    } catch (err) {
      logger.error("documents.reconcile_full_sweep.tenant_failed", {
        orgId: org.id,
        errorMessage: err instanceof Error ? err.message : String(err)
      });
    }
  }
}

async function reconcileTenantFullSweep(db: AdminClient, orgId: string): Promise<void> {
  const { data: config, error: configError } = await db
    .from("tenant_paperless_config")
    .select("organization_id")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (configError) throw configError;
  if (!config) return;

  const paperless = await paperlessFor(orgId);
  const paperlessIds = await listAllPaperlessDocumentIds(paperless);

  const { data: mirrored, error: mirrorError } = await db
    .from("documents")
    .select("id, paperless_document_id")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .neq("status", "orphaned");
  if (mirrorError) throw mirrorError;

  const mirroredIds = new Set((mirrored ?? []).map((row) => row.paperless_document_id));
  const missingIds = [...paperlessIds].filter((id) => !mirroredIds.has(id));
  const orphanedRows = (mirrored ?? []).filter(
    (row) => !paperlessIds.has(row.paperless_document_id)
  );

  for (const paperlessDocumentId of missingIds) {
    await enqueue(QUEUE_NAMES.syncPaperlessDocument, { orgId, paperlessDocumentId });
  }

  if (orphanedRows.length > 0) {
    const { error: orphanError } = await db
      .from("documents")
      .update({ status: "orphaned" })
      .in(
        "id",
        orphanedRows.map((row) => row.id)
      );
    if (orphanError) throw orphanError;
  }

  const { error: updateError } = await db
    .from("tenant_paperless_config")
    .update({ last_reconciled_at: new Date().toISOString() })
    .eq("organization_id", orgId);
  if (updateError) throw updateError;

  logger.info("documents.reconcile_full_sweep.tenant_completed", {
    orgId,
    paperlessCount: paperlessIds.size,
    missingCount: missingIds.length,
    orphanedCount: orphanedRows.length
  });
}
