"use server";

import { ZodError } from "zod";

import { toSafeError } from "@/lib/errors";
import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import { QUEUE_PRIORITY } from "@/lib/queue/config";
import { setRuleBackfillControl } from "@/lib/rules/backfill-control";
import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";

import { buildDocumentSubjectContext } from "./rules.context";
import { evaluateConditions } from "./rules.evaluator";
import {
  createRuleSchema,
  startRuleBackfillSchema,
  testRuleSchema,
  updateRuleSchema,
  type ConditionNode
} from "./rules.schemas";
import {
  createRule,
  deleteRule,
  getRule,
  listRuleRunsForDocument,
  listRuleRunsForRule,
  listRules,
  updateRule
} from "./rules.service";
import { rulesConfig } from "@/config/rules";

// docs/adr/0009-route-handlers-vs-server-actions.md: rule CRUD is a Server Action, same as every
// other module's mutations. GET /api/rule-backfills/[id]/route.ts (progress polling) is the one
// Route Handler this module needs, mirroring imports' own split.

export async function createRuleAction(input: unknown) {
  requireFeature("rules");
  const parsed = createRuleSchema.parse(input);
  const ctx = await buildRequestContext();
  return actionResult(() => createRule(ctx, parsed));
}

export async function updateRuleAction(ruleId: string, input: unknown) {
  requireFeature("rules");
  const parsed = updateRuleSchema.parse(input);
  const ctx = await buildRequestContext();
  return actionResult(() => updateRule(ctx, ruleId, parsed));
}

export async function deleteRuleAction(ruleId: string) {
  requireFeature("rules");
  const ctx = await buildRequestContext();
  return actionResult(() => deleteRule(ctx, ruleId));
}

export async function listRulesAction() {
  requireFeature("rules");
  const ctx = await buildRequestContext();
  return actionResult(() => listRules(ctx));
}

export async function getRuleAction(ruleId: string) {
  requireFeature("rules");
  const ctx = await buildRequestContext();
  return actionResult(() => getRule(ctx, ruleId));
}

export async function listRuleRunsForRuleAction(ruleId: string) {
  requireFeature("rules");
  const ctx = await buildRequestContext();
  return actionResult(() => listRuleRunsForRule(ctx, ruleId));
}

export async function listRuleRunsForDocumentAction(documentId: string) {
  requireFeature("rules");
  const ctx = await buildRequestContext();
  return actionResult(() => listRuleRunsForDocument(ctx, documentId));
}

// specs/03-api.md POST /rules/:id/test — dry run only: no rule_runs row, no actions dispatched.
// Returns the same {matched, conditions_trace, actions} shape the spec names, which is what the
// condition-trace UI renders.
export async function testRuleAction(input: unknown) {
  requireFeature("rules");
  const parsed = testRuleSchema.parse(input);
  const ctx = await buildRequestContext();
  return actionResult(async () => {
    const rule = await getRule(ctx, parsed.ruleId);
    const subject = await buildDocumentSubjectContext(ctx, parsed.documentId);
    const { matched, trace } = evaluateConditions(rule.conditions as unknown as ConditionNode, subject);
    return { matched, conditionsTrace: trace, actions: matched ? rule.actions : [] };
  });
}

// specs/07-rules-engine.md §Dry run and backfill: "Always runs a dry-run count first" — a plain
// count against the same filter claim_rule_backfill_documents() will later page through, so the
// number shown to the user is exactly what the real run will consider.
export async function previewRuleBackfillAction(input: unknown) {
  requireFeature("rules");
  const parsed = startRuleBackfillSchema.parse(input);
  const ctx = await buildRequestContext();
  return actionResult(async () => {
    let query = ctx.db
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.orgId)
      .is("deleted_at", null);
    if (parsed.filter.documentTypeKey) query = query.eq("document_type_key", parsed.filter.documentTypeKey);
    if (parsed.filter.dateFrom) query = query.gte("document_date", parsed.filter.dateFrom);
    if (parsed.filter.dateTo) query = query.lte("document_date", parsed.filter.dateTo);
    const { count, error } = await query;
    if (error) throw error;
    return { matchedCount: count ?? 0 };
  });
}

export async function startRuleBackfillAction(input: unknown) {
  requireFeature("rules");
  const parsed = startRuleBackfillSchema.parse(input);
  const ctx = await buildRequestContext();
  return actionResult(async () => {
    await getRule(ctx, parsed.ruleId); // 404s cleanly if the rule doesn't belong to this org

    const { data, error } = await ctx.db
      .from("rule_backfills")
      .insert({
        organization_id: ctx.orgId,
        rule_id: parsed.ruleId,
        filter: parsed.filter,
        created_by: ctx.actorId
      })
      .select("*")
      .single();
    if (error) throw error;

    await setRuleBackfillControl(data.id, "running");
    for (let i = 0; i < rulesConfig.defaultBackfillConcurrencyPerOrganization; i++) {
      await enqueue(
        QUEUE_NAMES.backfillRule,
        { orgId: ctx.orgId, ruleBackfillId: data.id },
        { priority: QUEUE_PRIORITY.ruleBackfill }
      );
    }

    return data;
  });
}

export async function pauseRuleBackfillAction(ruleBackfillId: string) {
  requireFeature("rules");
  await buildRequestContext();
  return actionResult(() => setRuleBackfillControl(ruleBackfillId, "paused"));
}

export async function resumeRuleBackfillAction(ruleBackfillId: string) {
  requireFeature("rules");
  const ctx = await buildRequestContext();
  return actionResult(async () => {
    await setRuleBackfillControl(ruleBackfillId, "running");
    await enqueue(
      QUEUE_NAMES.backfillRule,
      { orgId: ctx.orgId, ruleBackfillId },
      { priority: QUEUE_PRIORITY.ruleBackfill }
    );
  });
}

export async function cancelRuleBackfillAction(ruleBackfillId: string) {
  requireFeature("rules");
  await buildRequestContext();
  return actionResult(() => setRuleBackfillControl(ruleBackfillId, "cancelled"));
}

// specs/07-rules-engine.md: "reversible for connections created in the run" — scoped strictly
// to this backfill's own connections via undo_rule_backfill() (docs/adr/0010), never a bare
// rule_id match. The RPC itself checks auth.uid()/ownership, so this is a thin pass-through.
export async function undoRuleBackfillAction(ruleBackfillId: string) {
  requireFeature("rules");
  const ctx = await buildRequestContext();
  return actionResult(async () => {
    const { data, error } = await ctx.db.rpc("undo_rule_backfill", {
      p_rule_backfill_id: ruleBackfillId,
      p_organization_id: ctx.orgId
    });
    if (error) throw error;
    return { connectionsRemoved: data as number };
  });
}

async function actionResult<T>(
  run: () => Promise<T>
): Promise<{ data: T; error?: never } | { data?: never; error: string }> {
  try {
    return { data: await run() };
  } catch (error) {
    if (error instanceof ZodError) return { error: error.issues.map((issue) => issue.message).join("; ") };
    return { error: toSafeError(error).message };
  }
}
