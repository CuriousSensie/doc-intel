import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { FormMessage } from "@/components/forms/form-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteRuleButton } from "@/components/rules/delete-rule-button";
import { RuleBackfillPanel } from "@/components/rules/rule-backfill-panel";
import { RuleDetailTabs } from "@/components/rules/rule-detail-tabs";
import { RuleForm, type RuleFormValue } from "@/components/rules/rule-form";
import { RuleTestPanel } from "@/components/rules/rule-test-panel";
import { AuthorizationError, NotFoundError } from "@/lib/errors";
import { paperlessFor } from "@/lib/paperless/client";
import { getCachedCorrespondents, getCachedDocumentTypes, getCachedTags } from "@/lib/paperless/metadata-cache";
import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { getMembership } from "@/modules/organizations/organizations.service";
import { listRuleBackfillsForRuleAction, toggleRuleEnabledFormAction } from "@/modules/rules/rules.actions";
import { triggerMessageKey, type RuleAction } from "@/modules/rules/rules.schemas";
import { getRule, listRuleRunsForRule } from "@/modules/rules/rules.service";

export const dynamic = "force-dynamic";

// entity_ref for connect_entity/disconnect_entity only ever stores {by:"id", entityId} — the
// rule-form builder has no other way to show a human-readable chip for a bare id, so this
// resolves each referenced entity's current display name and attaches it as `label` before the
// action ever reaches the client. Never sent back to the server as-is; RuleForm rebuilds a fresh
// {by:"id", entityId} on submit (rules.dispatcher.ts#resolveEntityRef() re-checks org ownership
// at evaluation time regardless).
async function enrichEntityRefs(
  ctx: Awaited<ReturnType<typeof buildRequestContext>>,
  actions: unknown
): Promise<unknown> {
  const list = Array.isArray(actions) ? (actions as RuleAction[]) : [];
  const entityIds = list
    .filter((a) => (a.type === "connect_entity" || a.type === "disconnect_entity") && a.entity_ref.by === "id")
    .map((a) => (a as Extract<RuleAction, { type: "connect_entity" | "disconnect_entity" }>).entity_ref)
    .filter((ref): ref is Extract<typeof ref, { by: "id" }> => ref.by === "id")
    .map((ref) => ref.entityId);

  if (entityIds.length === 0) return actions;

  const { data } = await ctx.db.from("entities").select("id, display_name").in("id", entityIds);
  const labelById = new Map((data ?? []).map((e) => [e.id, e.display_name]));

  return list.map((action) => {
    if (
      (action.type === "connect_entity" || action.type === "disconnect_entity") &&
      action.entity_ref.by === "id"
    ) {
      const label = labelById.get(action.entity_ref.entityId);
      return label ? { ...action, entity_ref: { ...action.entity_ref, label } } : action;
    }
    return action;
  });
}

export default async function RuleDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  requireFeature("rules");
  const [{ id }, search, t] = await Promise.all([params, searchParams, getTranslations("rules")]);
  const { user } = await requireUser(`/dashboard/rules/${id}`);
  const ctx = await buildRequestContext();

  const membership = await getMembership(ctx.orgId, user.id);
  if (membership?.role !== "owner" && membership?.role !== "admin") {
    throw new AuthorizationError(t("authorization.manageOnly"));
  }

  let rule: Awaited<ReturnType<typeof getRule>>;
  try {
    rule = await getRule(ctx, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const client = await paperlessFor(ctx.orgId);
  const [runs, backfillsResult, tags, correspondents, documentTypes, enrichedActions] = await Promise.all([
    listRuleRunsForRule(ctx, id),
    listRuleBackfillsForRuleAction(id),
    getCachedTags(client, ctx.orgId),
    getCachedCorrespondents(client, ctx.orgId),
    getCachedDocumentTypes(client, ctx.orgId),
    enrichEntityRefs(ctx, rule.actions)
  ]);
  const recentBackfills = backfillsResult.data ?? [];

  const formValue: RuleFormValue = {
    id: rule.id,
    name: rule.name,
    trigger: rule.trigger,
    priority: rule.priority,
    conditions: rule.conditions,
    actions: enrichedActions
  };

  return (
    <div className="mx-auto grid w-full max-w-[1800px] gap-4 px-1">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black">{rule.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {t("list.trigger", { trigger: t(`triggers.${triggerMessageKey(rule.trigger)}`) })} ·{" "}
            {t("list.priority", { priority: rule.priority })}
          </p>
        </div>
        <Badge variant={rule.enabled ? "accent" : "muted"}>
          {rule.enabled ? t("list.enabled") : t("list.disabled")}
        </Badge>
      </div>

      <FormMessage error={search.error} message={search.message} />

      <div className="flex flex-wrap gap-2">
        <form action={toggleRuleEnabledFormAction}>
          <input name="ruleId" type="hidden" value={rule.id} />
          <input name="enabled" type="hidden" value={(!rule.enabled).toString()} />
          <Button type="submit" variant="outline">
            {rule.enabled ? t("detail.disable") : t("detail.enable")}
          </Button>
        </form>
        <DeleteRuleButton ruleId={rule.id} />
      </div>

      <RuleDetailTabs
        backfill={<RuleBackfillPanel recentBackfills={recentBackfills} ruleId={rule.id} />}
        rule={<RuleForm initial={formValue} metaOptions={{ tags, correspondents, documentTypes }} />}
        runs={
          <Card>
            <CardHeader>
              <CardTitle>{t("detail.recentRuns")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {runs.length === 0 ? (
                <p className="text-sm text-muted">{t("detail.noRuns")}</p>
              ) : (
                runs.map((run) => (
                  <div
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-panel px-3 py-2 text-sm"
                    key={run.id}
                  >
                    <span>{run.matched ? t("detail.runMatched") : t("detail.runNotMatched")}</span>
                    <span className="text-xs text-muted">{t("detail.runStatus", { status: run.status })}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        }
        test={<RuleTestPanel ruleId={rule.id} />}
      />
    </div>
  );
}
