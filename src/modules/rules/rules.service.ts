import { NotFoundError } from "@/lib/errors";
import { logEvent } from "@/lib/events";
import type { ServiceContext } from "@/lib/service-context";
import type { Database, Json } from "@/types/database";

import { evaluateForDelegation } from "./rules.delegation";
import type { CreateRuleInput, UpdateRuleInput } from "./rules.schemas";

export type Rule = Database["public"]["Tables"]["rules"]["Row"];
export type RuleRun = Database["public"]["Tables"]["rule_runs"]["Row"];

async function fetchRule(ctx: ServiceContext, ruleId: string): Promise<Rule> {
  const { data, error } = await ctx.db
    .from("rules")
    .select("*")
    .eq("id", ruleId)
    .eq("organization_id", ctx.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NotFoundError("Rule not found");
  return data;
}

export async function getRule(ctx: ServiceContext, ruleId: string): Promise<Rule> {
  return fetchRule(ctx, ruleId);
}

export async function listRules(ctx: ServiceContext): Promise<Rule[]> {
  const { data, error } = await ctx.db
    .from("rules")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .is("deleted_at", null)
    .order("priority", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw error;
  return data;
}

// specs/07-rules-engine.md §What is ours vs. Paperless's: evaluated once at create/update time,
// not per trigger fire — a rule's delegated-or-local status only changes when its own actions
// change. rules.delegation.ts talks to Paperless (creating/updating a workflow object) when
// delegating; a rule whose actions later stop being fully Paperless-native falls back to local
// evaluation and its now-orphaned workflow is disabled, never left double-executing (spec's
// explicit "never implement both paths for the same rule" warning).
export async function createRule(ctx: ServiceContext, input: CreateRuleInput): Promise<Rule> {
  const delegation = await evaluateForDelegation(ctx, input.actions);

  const { data, error } = await ctx.db
    .from("rules")
    .insert({
      organization_id: ctx.orgId,
      name: input.name,
      trigger: input.trigger,
      priority: input.priority,
      conditions: input.conditions as unknown as Json,
      actions: input.actions as unknown as Json,
      delegate_to_paperless: delegation.delegated,
      paperless_workflow_id: delegation.paperlessWorkflowId,
      created_by: ctx.actorId
    })
    .select("*")
    .single();

  if (error) throw error;

  await logEvent({
    actorId: ctx.actorId,
    action: "rule.created",
    entityType: "rule",
    entityId: data.id,
    organizationId: ctx.orgId,
    metadata: { trigger: data.trigger, delegated: data.delegate_to_paperless }
  });

  return data;
}

export async function updateRule(ctx: ServiceContext, ruleId: string, input: UpdateRuleInput): Promise<Rule> {
  const existing = await fetchRule(ctx, ruleId);

  const nextActions = input.actions ?? (existing.actions as unknown as CreateRuleInput["actions"]);
  const delegation =
    input.actions !== undefined
      ? await evaluateForDelegation(ctx, nextActions, existing.paperless_workflow_id)
      : { delegated: existing.delegate_to_paperless, paperlessWorkflowId: existing.paperless_workflow_id };

  const { data, error } = await ctx.db
    .from("rules")
    .update({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.trigger !== undefined ? { trigger: input.trigger } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.conditions !== undefined ? { conditions: input.conditions as unknown as Json } : {}),
      ...(input.actions !== undefined ? { actions: input.actions as unknown as Json } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      delegate_to_paperless: delegation.delegated,
      paperless_workflow_id: delegation.paperlessWorkflowId
    })
    .eq("id", ruleId)
    .eq("organization_id", ctx.orgId)
    .select("*")
    .single();

  if (error) throw error;

  await logEvent({
    actorId: ctx.actorId,
    action: "rule.updated",
    entityType: "rule",
    entityId: ruleId,
    organizationId: ctx.orgId,
    metadata: { delegated: data.delegate_to_paperless }
  });

  return data;
}

// Soft-delete only (disable + tombstone) — a rule with existing rule_runs keeps its audit trail
// readable (matches the entity-type soft-remove precedent, src/modules/entity-types/).
export async function deleteRule(ctx: ServiceContext, ruleId: string): Promise<void> {
  await fetchRule(ctx, ruleId);

  const { error } = await ctx.db
    .from("rules")
    .update({ enabled: false, deleted_at: new Date().toISOString() })
    .eq("id", ruleId)
    .eq("organization_id", ctx.orgId);

  if (error) throw error;

  await logEvent({
    actorId: ctx.actorId,
    action: "rule.deleted",
    entityType: "rule",
    entityId: ruleId,
    organizationId: ctx.orgId
  });
}

export async function listRulesForTrigger(ctx: ServiceContext, trigger: Rule["trigger"]): Promise<Rule[]> {
  const { data, error } = await ctx.db
    .from("rules")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .eq("trigger", trigger)
    .eq("enabled", true)
    .eq("delegate_to_paperless", false)
    .is("deleted_at", null)
    .order("priority", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw error;
  return data;
}

export async function listRuleRunsForRule(ctx: ServiceContext, ruleId: string): Promise<RuleRun[]> {
  const { data, error } = await ctx.db
    .from("rule_runs")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .eq("rule_id", ruleId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw error;
  return data;
}

export async function listRuleRunsForDocument(ctx: ServiceContext, documentId: string): Promise<RuleRun[]> {
  const { data, error } = await ctx.db
    .from("rule_runs")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .eq("document_id", documentId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return data;
}
