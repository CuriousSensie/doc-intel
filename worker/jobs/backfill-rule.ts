import { randomUUID } from "node:crypto";

import type { Job } from "bullmq";

import { rulesConfig } from "@/config/rules";
import { logger } from "@/lib/logger";
import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import { getRuleBackfillControl } from "@/lib/rules/backfill-control";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ServiceContext } from "@/lib/service-context";
import { buildDocumentSubjectContext } from "@/modules/rules/rules.context";
import { dispatchRuleActions } from "@/modules/rules/rules.dispatcher";
import { evaluateConditions } from "@/modules/rules/rules.evaluator";
import type { ConditionNode } from "@/modules/rules/rules.schemas";
import { createNotification } from "@/modules/notifications/notifications.service";
import type { JobPayload } from "../context";

type BackfillRulePayload = JobPayload & { ruleBackfillId: string };
type AdminDb = ReturnType<typeof createAdminClient>;
type BackfillFilter = { documentTypeKey?: string; dateFrom?: string; dateTo?: string };

async function claimChunk(admin: AdminDb, orgId: string, ruleBackfillId: string, filter: BackfillFilter) {
  const { data, error } = await admin.rpc("claim_rule_backfill_documents", {
    p_rule_backfill_id: ruleBackfillId,
    p_organization_id: orgId,
    p_limit: rulesConfig.backfillChunkSize,
    p_document_type_key: filter.documentTypeKey ?? null,
    p_date_from: filter.dateFrom ?? null,
    p_date_to: filter.dateTo ?? null
  });
  if (error) throw error;
  return data ?? [];
}

async function tryFinalize(admin: AdminDb, orgId: string, ruleBackfillId: string): Promise<void> {
  const { data: didComplete, error } = await admin.rpc("complete_rule_backfill", {
    p_rule_backfill_id: ruleBackfillId,
    p_organization_id: orgId
  });
  if (error) throw error;
  if (!didComplete) return;

  const { data: backfill } = await admin
    .from("rule_backfills")
    .select("created_by, matched_count, applied_count, rule_id")
    .eq("id", ruleBackfillId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!backfill?.created_by) return;

  const { data: rule } = await admin.from("rules").select("name").eq("id", backfill.rule_id).maybeSingle();

  await createNotification(backfill.created_by, {
    type: "rule.backfill_completed",
    title: "Rule backfill finished",
    message: `"${rule?.name ?? "Rule"}" backfill finished: ${backfill.matched_count} matched, ${backfill.applied_count} applied.`,
    metadata: { ruleBackfillId }
  });
}

// specs/07-rules-engine.md §Dry run and backfill: chunked, pausable, fully audited, reversible.
// Mirrors worker/jobs/run-import-chunk.ts's self-perpetuating chain shape — a Redis control flag
// checked before each claim, cursor-based pagination over the filtered document set (see
// claim_rule_backfill_documents() in the migration for why this isn't a row-claim table), one
// re-enqueue per chunk while still running.
export async function backfillRuleJob(job: Job<JobPayload>): Promise<void> {
  const { orgId, ruleBackfillId } = job.data as BackfillRulePayload;

  const control = await getRuleBackfillControl(ruleBackfillId);
  if (control !== "running") {
    logger.info("rules.backfill.stopped", { orgId, ruleBackfillId, control });
    return;
  }

  const admin = createAdminClient();
  const { data: backfill, error: backfillError } = await admin
    .from("rule_backfills")
    .select("*")
    .eq("id", ruleBackfillId)
    .eq("organization_id", orgId)
    .single();
  if (backfillError) throw backfillError;

  const { data: rule, error: ruleError } = await admin
    .from("rules")
    .select("*")
    .eq("id", backfill.rule_id)
    .eq("organization_id", orgId)
    .single();
  if (ruleError) throw ruleError;

  const filter = (backfill.filter as BackfillFilter) ?? {};
  const documents = await claimChunk(admin, orgId, ruleBackfillId, filter);

  if (documents.length === 0) {
    await tryFinalize(admin, orgId, ruleBackfillId);
    return;
  }

  const ctx: ServiceContext = { db: admin, orgId, actorId: backfill.created_by, correlationId: randomUUID() };
  let matchedDelta = 0;
  let appliedDelta = 0;
  let lastDocumentId = backfill.cursor_document_id;

  for (const doc of documents) {
    lastDocumentId = doc.id;
    try {
      const subject = await buildDocumentSubjectContext(ctx, doc.id);
      const { matched, trace } = evaluateConditions(rule.conditions as unknown as ConditionNode, subject);

      const { data: ruleRun, error: ruleRunError } = await admin
        .from("rule_runs")
        .insert({
          organization_id: orgId,
          rule_id: rule.id,
          document_id: doc.id,
          trigger: "manual",
          matched,
          conditions_trace: trace as never,
          status: "ok",
          cascade_depth: 0
        })
        .select("id")
        .single();
      if (ruleRunError) throw ruleRunError;

      if (matched) {
        matchedDelta++;
        const fieldClaims = new Map<string, string>();
        const outcomes = await dispatchRuleActions(ctx, rule, ruleRun.id, subject, fieldClaims, {
          ruleBackfillId
        });
        if (outcomes.some((o) => o.status === "applied")) appliedDelta++;
      }
    } catch (err) {
      logger.error("rules.backfill.document_failed", {
        orgId,
        ruleBackfillId,
        documentId: doc.id,
        errorMessage: err instanceof Error ? err.message : String(err)
      });
    }
  }

  if (lastDocumentId) {
    const { error } = await admin.rpc("advance_rule_backfill_cursor", {
      p_rule_backfill_id: ruleBackfillId,
      p_organization_id: orgId,
      p_cursor_document_id: lastDocumentId
    });
    if (error) throw error;
  }

  if (matchedDelta > 0 || appliedDelta > 0) {
    const { error } = await admin.rpc("increment_rule_backfill_progress", {
      p_rule_backfill_id: ruleBackfillId,
      p_organization_id: orgId,
      p_matched_delta: matchedDelta,
      p_applied_delta: appliedDelta
    });
    if (error) throw error;
  }

  const nextControl = await getRuleBackfillControl(ruleBackfillId);
  if (nextControl === "running") {
    await enqueue(QUEUE_NAMES.backfillRule, { orgId, ruleBackfillId });
  }
}
