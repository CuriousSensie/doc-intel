import { logger } from "@/lib/logger";
import { paperlessFor } from "@/lib/paperless/client";
import { listAllPaperlessDocumentIds } from "@/lib/paperless/documents";
import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

// Covers clock drift between this worker and Paperless, and the window between a tenant's
// last successful sweep and this one starting — specs/01-architecture.md says "since
// last_reconciled_at minus overlap window" without naming a value; 2 minutes comfortably
// covers a 5-minute cadence without re-scanning meaningfully more than the previous tick did.
const OVERLAP_MS = 2 * 60 * 1000;

/**
 * specs/01-architecture.md §Event bridge, secondary path: every 5 minutes, per tenant, query
 * Paperless for documents added/modified since last_reconciled_at and enqueue sync for
 * anything found. This is the *fast* half of reconciliation — it can only ever see documents
 * Paperless reports as added/modified inside the window, so it structurally cannot detect a
 * Paperless-side deletion (see reconcile-full-sweep.ts for that).
 *
 * One job that loops over every tenant internally, not one job fanned out per tenant — no
 * queue/payload contract exists for "reconcile one tenant" (same shape as
 * expire-abandoned-uploads.ts's global sweep). A single tenant's failure is logged and skipped
 * rather than aborting the rest of the loop.
 */
export async function reconcileIncremental(): Promise<void> {
  const db = createAdminClient();

  const { data: orgs, error } = await db
    .from("organizations")
    .select("id")
    .eq("provisioning_status", "ready");
  if (error) throw error;

  for (const org of orgs ?? []) {
    try {
      await reconcileTenantIncremental(db, org.id);
    } catch (err) {
      logger.error("documents.reconcile_incremental.tenant_failed", {
        orgId: org.id,
        errorMessage: err instanceof Error ? err.message : String(err)
      });
    }
  }
}

async function reconcileTenantIncremental(db: AdminClient, orgId: string): Promise<void> {
  const { data: config, error: configError } = await db
    .from("tenant_paperless_config")
    .select("last_reconciled_at")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (configError) throw configError;
  if (!config) {
    // Ready but not yet linked (edge case between provisioning steps) — nothing to reconcile.
    return;
  }

  const since = config.last_reconciled_at
    ? new Date(new Date(config.last_reconciled_at).getTime() - OVERLAP_MS)
    : new Date(0);

  const paperless = await paperlessFor(orgId);
  const sinceParam = encodeURIComponent(since.toISOString());

  const [addedIds, modifiedIds] = await Promise.all([
    listAllPaperlessDocumentIds(paperless, `added__gte=${sinceParam}`),
    listAllPaperlessDocumentIds(paperless, `modified__gte=${sinceParam}`)
  ]);

  const candidateIds = new Set<number>([...addedIds, ...modifiedIds]);

  // Enqueued for every candidate, not just ones missing from our mirror — sync-paperless-
  // document.ts upserts, so re-syncing an already-mirrored-but-modified document is exactly
  // how a Paperless-side metadata edit (retitled, re-typed) ever reaches the mirror at all.
  for (const paperlessDocumentId of candidateIds) {
    await enqueue(QUEUE_NAMES.syncPaperlessDocument, { orgId, paperlessDocumentId });
  }

  const { error: updateError } = await db
    .from("tenant_paperless_config")
    .update({ last_reconciled_at: new Date().toISOString() })
    .eq("organization_id", orgId);
  if (updateError) throw updateError;

  logger.info("documents.reconcile_incremental.tenant_completed", {
    orgId,
    candidateCount: candidateIds.size
  });
}
