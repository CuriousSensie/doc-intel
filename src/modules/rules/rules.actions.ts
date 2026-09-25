"use server";

import { getLocale, getTranslations } from "next-intl/server";
import { ZodError } from "zod";

import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { toSafeError } from "@/lib/errors";
import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import { QUEUE_PRIORITY } from "@/lib/queue/config";
import { setRuleBackfillControl } from "@/lib/rules/backfill-control";
import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import { withStatus } from "@/modules/auth/redirects";

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

// docs/adr/0009-route-handlers-vs-server-actions.md: rule CRUD is a Server Action, same as every
// other module's mutations. GET /api/rule-backfills/[id]/route.ts (progress polling) is the one
// Route Handler this module needs.

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
    // Exactly one initial job, not one per rulesConfig.defaultBackfillConcurrencyPerOrganization
    // (that constant is a per-org concurrency bound, not a fan-out target for this job — this
    // job's own claim, claim_rule_backfill_documents(), is cursor pagination by design (see the
    // migration's comment): N concurrently-enqueued copies would all read the same
    // cursor_document_id before any of them advances it, so a real N-way duplicate-processing
    // bug (confirmed live: 2 real matching documents produced matched_count=8 with N=4) rather
    // than N-way parallelism. The self-perpetuating re-enqueue in backfill-rule.ts already
    // provides the "keep going" chain; a second concurrent chain has nothing safe to do.
    await enqueue(
      QUEUE_NAMES.backfillRule,
      { orgId: ctx.orgId, ruleBackfillId: data.id },
      { priority: QUEUE_PRIORITY.ruleBackfill }
    );

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

type Translator = Awaited<ReturnType<typeof getTranslations>>;

function redirectWithError(path: string, error: unknown, t: Translator, locale: Locale): never {
  const message =
    error instanceof ZodError
      ? error.issues.map((issue) => issue.message).join("; ")
      : error instanceof Error
        ? error.message
        : t("actions.somethingWentWrong");
  return redirect({ href: withStatus(path, "error", message), locale });
}

function redirectTarget(formData: FormData, fallback: string): string {
  const value = formData.get("redirectTo");
  return typeof value === "string" && value.startsWith("/") ? value : fallback;
}

// Plain <form action={...}> handlers for the /dashboard/rules UI — same split as
// entity-types.actions.ts: the typed *Action functions above serve client-side/JSON callers
// (the test/backfill panels, which need to render a result inline without navigating), these
// serve server-rendered forms with a redirect-with-status result.

export async function createRuleFormAction(formData: FormData) {
  requireFeature("rules");
  const ctx = await buildRequestContext();
  const [t, locale] = await Promise.all([getTranslations("rules"), getLocale()]);

  let ruleId: string;
  try {
    const parsed = createRuleSchema.parse({
      name: formData.get("name"),
      trigger: formData.get("trigger"),
      priority: Number(formData.get("priority") ?? 100),
      conditions: JSON.parse(String(formData.get("conditions"))),
      actions: JSON.parse(String(formData.get("actions")))
    });
    const rule = await createRule(ctx, parsed);
    ruleId = rule.id;
  } catch (error) {
    redirectWithError("/dashboard/rules/new", error, t, locale);
  }

  return redirect({ href: withStatus(`/dashboard/rules/${ruleId}`, "message", t("actions.created")), locale });
}

export async function updateRuleFormAction(formData: FormData) {
  requireFeature("rules");
  const ctx = await buildRequestContext();
  const [t, locale] = await Promise.all([getTranslations("rules"), getLocale()]);
  const ruleId = String(formData.get("ruleId"));

  try {
    const parsed = updateRuleSchema.parse({
      name: formData.get("name"),
      trigger: formData.get("trigger"),
      priority: Number(formData.get("priority") ?? 100),
      conditions: JSON.parse(String(formData.get("conditions"))),
      actions: JSON.parse(String(formData.get("actions")))
    });
    await updateRule(ctx, ruleId, parsed);
  } catch (error) {
    redirectWithError(`/dashboard/rules/${ruleId}`, error, t, locale);
  }

  return redirect({ href: withStatus(`/dashboard/rules/${ruleId}`, "message", t("actions.saved")), locale });
}

export async function toggleRuleEnabledFormAction(formData: FormData) {
  requireFeature("rules");
  const ctx = await buildRequestContext();
  const [t, locale] = await Promise.all([getTranslations("rules"), getLocale()]);
  const ruleId = String(formData.get("ruleId"));
  const enabled = formData.get("enabled") === "true";
  const returnPath = redirectTarget(formData, `/dashboard/rules/${ruleId}`);

  try {
    await updateRule(ctx, ruleId, { enabled });
  } catch (error) {
    redirectWithError(returnPath, error, t, locale);
  }

  return redirect({
    href: withStatus(returnPath, "message", enabled ? t("actions.enabled") : t("actions.disabled")),
    locale
  });
}

export async function deleteRuleFormAction(formData: FormData) {
  requireFeature("rules");
  const ctx = await buildRequestContext();
  const [t, locale] = await Promise.all([getTranslations("rules"), getLocale()]);
  const ruleId = String(formData.get("ruleId"));

  try {
    await deleteRule(ctx, ruleId);
  } catch (error) {
    redirectWithError(`/dashboard/rules/${ruleId}`, error, t, locale);
  }

  return redirect({ href: withStatus("/dashboard/rules", "message", t("actions.deleted")), locale });
}

export async function startRuleBackfillFormAction(formData: FormData) {
  requireFeature("rules");
  const ctx = await buildRequestContext();
  const [t, locale] = await Promise.all([getTranslations("rules"), getLocale()]);
  const ruleId = String(formData.get("ruleId"));
  const returnPath = redirectTarget(formData, `/dashboard/rules/${ruleId}`);

  try {
    const documentTypeKey = formData.get("documentTypeKey");
    const dateFrom = formData.get("dateFrom");
    const dateTo = formData.get("dateTo");
    const parsed = startRuleBackfillSchema.parse({
      ruleId,
      filter: {
        documentTypeKey: documentTypeKey ? String(documentTypeKey) : undefined,
        dateFrom: dateFrom ? String(dateFrom) : undefined,
        dateTo: dateTo ? String(dateTo) : undefined
      }
    });

    await getRule(ctx, ruleId);
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
    // See startRuleBackfillAction()'s comment: exactly one initial job — cursor-paginated
    // claiming isn't safe for N concurrent chains the way a row-claim table is.
    await enqueue(
      QUEUE_NAMES.backfillRule,
      { orgId: ctx.orgId, ruleBackfillId: data.id },
      { priority: QUEUE_PRIORITY.ruleBackfill }
    );
  } catch (error) {
    redirectWithError(returnPath, error, t, locale);
  }

  return redirect({ href: withStatus(returnPath, "message", t("actions.backfillStarted")), locale });
}

export async function pauseRuleBackfillFormAction(formData: FormData) {
  requireFeature("rules");
  await buildRequestContext();
  const [t, locale] = await Promise.all([getTranslations("rules"), getLocale()]);
  const ruleId = String(formData.get("ruleId"));
  await setRuleBackfillControl(String(formData.get("ruleBackfillId")), "paused");
  return redirect({ href: withStatus(`/dashboard/rules/${ruleId}`, "message", t("actions.backfillPaused")), locale });
}

export async function resumeRuleBackfillFormAction(formData: FormData) {
  requireFeature("rules");
  const ctx = await buildRequestContext();
  const [t, locale] = await Promise.all([getTranslations("rules"), getLocale()]);
  const ruleId = String(formData.get("ruleId"));
  const ruleBackfillId = String(formData.get("ruleBackfillId"));
  await setRuleBackfillControl(ruleBackfillId, "running");
  await enqueue(
    QUEUE_NAMES.backfillRule,
    { orgId: ctx.orgId, ruleBackfillId },
    { priority: QUEUE_PRIORITY.ruleBackfill }
  );
  return redirect({ href: withStatus(`/dashboard/rules/${ruleId}`, "message", t("actions.backfillResumed")), locale });
}

export async function cancelRuleBackfillFormAction(formData: FormData) {
  requireFeature("rules");
  await buildRequestContext();
  const [t, locale] = await Promise.all([getTranslations("rules"), getLocale()]);
  const ruleId = String(formData.get("ruleId"));
  await setRuleBackfillControl(String(formData.get("ruleBackfillId")), "cancelled");
  return redirect({ href: withStatus(`/dashboard/rules/${ruleId}`, "message", t("actions.backfillCancelled")), locale });
}

export async function listRuleBackfillsForRuleAction(ruleId: string) {
  requireFeature("rules");
  const ctx = await buildRequestContext();
  return actionResult(async () => {
    const { data, error } = await ctx.db
      .from("rule_backfills")
      .select("*")
      .eq("organization_id", ctx.orgId)
      .eq("rule_id", ruleId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw error;
    return data;
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
