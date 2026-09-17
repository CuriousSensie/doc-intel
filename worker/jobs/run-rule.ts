import type { Job } from "bullmq";

import { rulesConfig } from "@/config/rules";
import { logger } from "@/lib/logger";
import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import { buildDocumentSubjectContext, buildEntitySubjectContext, type SubjectContext } from "@/modules/rules/rules.context";
import { dispatchRuleActions } from "@/modules/rules/rules.dispatcher";
import { evaluateConditions } from "@/modules/rules/rules.evaluator";
import { listRulesForTrigger } from "@/modules/rules/rules.service";
import type { ConditionNode } from "@/modules/rules/rules.schemas";

import { contextForJob, type JobPayload } from "../context";

type RunRulePayload = JobPayload & {
  documentId?: string;
  entityId?: string;
  trigger: "document.ingested" | "document.updated" | "document.connected" | "entity.created" | "manual";
  cascadeDepth?: number;
};

// specs/07-rules-engine.md §Evaluation: one job per (subject, trigger) fire, all enabled
// non-delegated rules for that trigger run in priority order, every match's actions apply,
// conflicts resolve first-writer-wins within this one run. Fires QUEUE_NAMES.runRule again for
// document.connected cascades — worker/registry.ts previously had this as a no-op placeholder.
export async function runRuleJob(job: Job<JobPayload>): Promise<void> {
  const { orgId, documentId, entityId, trigger, cascadeDepth = 0 } = job.data as RunRulePayload;

  if (cascadeDepth > rulesConfig.maxCascadeDepth) {
    logger.info("rules.run_rule.cascade_capped", { orgId, documentId, entityId, trigger, cascadeDepth });
    return;
  }

  const ctx = contextForJob(job);
  const rules = await listRulesForTrigger(ctx, trigger);
  if (rules.length === 0) return;

  let subject: SubjectContext;
  try {
    subject = documentId
      ? await buildDocumentSubjectContext(ctx, documentId)
      : await buildEntitySubjectContext(ctx, entityId!);
  } catch (err) {
    logger.error("rules.run_rule.subject_build_failed", {
      orgId,
      documentId,
      entityId,
      trigger,
      errorMessage: err instanceof Error ? err.message : String(err)
    });
    return;
  }

  const fieldClaims = new Map<string, string>();
  const startedAt = Date.now();
  let cascadeTriggered = false;

  for (const rule of rules) {
    if (Date.now() - startedAt > rulesConfig.evaluationTimeoutMs) {
      logger.error("rules.run_rule.timeout", { orgId, documentId, entityId, trigger, ruleId: rule.id });
      await ctx.db.from("rule_runs").insert({
        organization_id: orgId,
        rule_id: rule.id,
        document_id: documentId ?? null,
        trigger,
        matched: false,
        status: "timeout",
        cascade_depth: cascadeDepth
      });
      continue;
    }

    const { matched, trace } = evaluateConditions(rule.conditions as unknown as ConditionNode, subject);

    const { data: ruleRun, error: ruleRunError } = await ctx.db
      .from("rule_runs")
      .insert({
        organization_id: orgId,
        rule_id: rule.id,
        document_id: documentId ?? null,
        trigger,
        matched,
        conditions_trace: trace as never,
        status: "ok",
        cascade_depth: cascadeDepth
      })
      .select("id")
      .single();

    if (ruleRunError) {
      logger.error("rules.run_rule.rule_run_insert_failed", {
        orgId,
        ruleId: rule.id,
        errorMessage: ruleRunError.message
      });
      continue;
    }

    if (!matched) continue;

    try {
      const outcomes = await dispatchRuleActions(ctx, rule, ruleRun.id, subject, fieldClaims);
      const connectedDocument = outcomes.some(
        (o) => (o.action.type === "connect_entity" || o.action.type === "assign_responsible") && o.status === "applied"
      );
      if (connectedDocument && subject.kind === "document") cascadeTriggered = true;
    } catch (err) {
      logger.error("rules.run_rule.dispatch_failed", {
        orgId,
        ruleId: rule.id,
        errorMessage: err instanceof Error ? err.message : String(err)
      });
      await ctx.db
        .from("rule_runs")
        .update({ status: "failed", error_message: (err instanceof Error ? err.message : String(err)).slice(0, 500) })
        .eq("id", ruleRun.id);
    }
  }

  // document.connected cascade (specs/07: "must not loop", cap enforced at the top of the next
  // job, not here) — only for a document subject, since connect_entity's source/target can also
  // be entity-to-entity, which isn't a subject shape this job builds yet.
  if (cascadeTriggered && subject.kind === "document") {
    await enqueue(QUEUE_NAMES.runRule, {
      orgId,
      documentId: subject.documentId,
      trigger: "document.connected",
      cascadeDepth: cascadeDepth + 1
    });
  }
}
