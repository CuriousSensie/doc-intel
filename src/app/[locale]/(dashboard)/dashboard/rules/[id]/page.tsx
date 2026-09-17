import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { DeleteRuleButton } from "@/components/rules/delete-rule-button";
import { RuleBackfillPanel } from "@/components/rules/rule-backfill-panel";
import { RuleTestPanel } from "@/components/rules/rule-test-panel";
import { AuthorizationError, NotFoundError } from "@/lib/errors";
import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { getMembership } from "@/modules/organizations/organizations.service";
import {
  listRuleBackfillsForRuleAction,
  toggleRuleEnabledFormAction,
  updateRuleFormAction
} from "@/modules/rules/rules.actions";
import { RULE_TRIGGERS } from "@/modules/rules/rules.schemas";
import { getRule, listRuleRunsForRule } from "@/modules/rules/rules.service";

export const dynamic = "force-dynamic";

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

  const [runs, backfillsResult] = await Promise.all([
    listRuleRunsForRule(ctx, id),
    listRuleBackfillsForRuleAction(id)
  ]);
  const recentBackfills = backfillsResult.data ?? [];

  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black">{rule.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {t("list.trigger", { trigger: t(`triggers.${rule.trigger}`) })} ·{" "}
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

      <Card>
        <CardHeader>
          <CardTitle>{t("form.save")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateRuleFormAction} className="grid gap-4">
            <input name="ruleId" type="hidden" value={rule.id} />
            <TextField
              defaultValue={rule.name}
              label={t("form.nameLabel")}
              name="name"
              placeholder={t("form.namePlaceholder")}
              required
            />

            <label className="grid gap-2 text-sm font-semibold">
              <span>{t("form.triggerLabel")}</span>
              <select
                className="min-h-11 rounded-md border border-border bg-panel px-3 text-base font-normal outline-none transition focus:border-foreground focus:ring-2 focus:ring-foreground/15"
                defaultValue={rule.trigger}
                name="trigger"
                required
              >
                {RULE_TRIGGERS.map((trigger) => (
                  <option key={trigger} value={trigger}>
                    {t(`triggers.${trigger}`)}
                  </option>
                ))}
              </select>
            </label>

            <TextField
              defaultValue={rule.priority}
              hint={t("form.priorityHint")}
              label={t("form.priorityLabel")}
              name="priority"
              type="number"
            />

            <label className="grid gap-2 text-sm font-semibold">
              <span>{t("form.conditionsLabel")}</span>
              <Textarea
                className="min-h-40 font-mono text-xs"
                defaultValue={JSON.stringify(rule.conditions, null, 2)}
                name="conditions"
                required
              />
              <span className="text-xs font-normal leading-5 text-muted">{t("form.conditionsHint")}</span>
            </label>

            <label className="grid gap-2 text-sm font-semibold">
              <span>{t("form.actionsLabel")}</span>
              <Textarea
                className="min-h-32 font-mono text-xs"
                defaultValue={JSON.stringify(rule.actions, null, 2)}
                name="actions"
                required
              />
              <span className="text-xs font-normal leading-5 text-muted">{t("form.actionsHint")}</span>
            </label>

            <Button type="submit">{t("form.save")}</Button>
          </form>
        </CardContent>
      </Card>

      <RuleTestPanel ruleId={rule.id} />

      <RuleBackfillPanel recentBackfills={recentBackfills} ruleId={rule.id} />

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
    </div>
  );
}
