import type { Job } from "bullmq";

import { rulesConfig } from "@/config/rules";
import { logger } from "@/lib/logger";
import { evaluateFolderMatchesForDocument } from "@/modules/folders/folders.service";
import { buildDocumentSubjectContext, type SubjectContext } from "@/modules/rules/rules.context";
import { dispatchRuleActions } from "@/modules/rules/rules.dispatcher";
import { evaluateConditions } from "@/modules/rules/rules.evaluator";
import { listRulesForTrigger } from "@/modules/rules/rules.service";
import type { ConditionNode } from "@/modules/rules/rules.schemas";

import { contextForJob, type JobPayload } from "../context";

type RunRulePayload = JobPayload & {
  documentId: string;
  trigger: "document.ingested" | "document.updated" | "manual";
};

// specs/07-rules-engine.md §Evaluation: one job per (document, trigger) fire, all enabled
// non-delegated rules for that trigger run in priority order, every match's actions apply,
// conflicts resolve first-writer-wins within this one run.
export async function runRuleJob(job: Job<JobPayload>): Promise<void> {
  const { orgId, documentId, trigger } = job.data as RunRulePayload;

  const ctx = contextForJob(job);
  const rules = await listRulesForTrigger(ctx, trigger);
  // ADR-0019: a folder's own match_conditions isn't a rules-table row, so folder auto-filing must
  // still run on document.ingested even for an org with zero authored rules for this trigger —
  // the `rules.length === 0` short-circuit below existed purely to skip the (real) cost of
  // building a subject when nothing would use it, which no longer holds for this one trigger.
  const needsFolderMatch = trigger === "document.ingested";
  if (rules.length === 0 && !needsFolderMatch) return;

  let subject: SubjectContext;
  try {
    subject = await buildDocumentSubjectContext(ctx, documentId);
  } catch (err) {
    logger.error("rules.run_rule.subject_build_failed", {
      orgId,
      documentId,
      trigger,
      errorMessage: err instanceof Error ? err.message : String(err)
    });
    return;
  }

  if (needsFolderMatch) {
    try {
      await evaluateFolderMatchesForDocument(ctx, documentId, subject);
    } catch (err) {
      logger.error("rules.run_rule.folder_match_failed", {
        orgId,
        documentId,
        errorMessage: err instanceof Error ? err.message : String(err)
      });
    }
  }

  if (rules.length === 0) return;

  const fieldClaims = new Map<string, string>();
  const startedAt = Date.now();

  for (const rule of rules) {
    if (Date.now() - startedAt > rulesConfig.evaluationTimeoutMs) {
      logger.error("rules.run_rule.timeout", { orgId, documentId, trigger, ruleId: rule.id });
      await ctx.db.from("rule_runs").insert({
        organization_id: orgId,
        rule_id: rule.id,
        document_id: documentId,
        trigger,
        matched: false,
        status: "timeout",
        cascade_depth: 0
      });
      continue;
    }

    const { matched, trace } = evaluateConditions(rule.conditions as unknown as ConditionNode, subject);

    const { data: ruleRun, error: ruleRunError } = await ctx.db
      .from("rule_runs")
      .insert({
        organization_id: orgId,
        rule_id: rule.id,
        document_id: documentId,
        trigger,
        matched,
        conditions_trace: trace as never,
        status: "ok",
        cascade_depth: 0
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
      await dispatchRuleActions(ctx, rule, ruleRun.id, subject, fieldClaims);
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
}
