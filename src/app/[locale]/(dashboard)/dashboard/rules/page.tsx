import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/forms/form-message";
import { RulesTable } from "@/components/rules/rules-table";
import { AuthorizationError } from "@/lib/errors";
import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { getMembership } from "@/modules/organizations/organizations.service";
import { countRuleRunsForRules, listRules } from "@/modules/rules/rules.service";

export const dynamic = "force-dynamic";

function countConditions(conditions: unknown): number {
  if (!conditions || typeof conditions !== "object") return 0;
  if ("all" in conditions && Array.isArray(conditions.all)) return conditions.all.length;
  if ("any" in conditions && Array.isArray(conditions.any)) return conditions.any.length;
  return "field" in conditions ? 1 : 0;
}

function countActions(actions: unknown): number {
  return Array.isArray(actions) ? actions.length : 0;
}

export default async function RulesListPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  requireFeature("rules");
  const [{ user }, ctx, t, search] = await Promise.all([
    requireUser("/dashboard/rules"),
    buildRequestContext(),
    getTranslations("rules"),
    searchParams
  ]);

  const membership = await getMembership(ctx.orgId, user.id);
  if (membership?.role !== "owner" && membership?.role !== "admin") {
    throw new AuthorizationError(t("authorization.manageOnly"));
  }

  const rules = await listRules(ctx);
  const runCounts = await countRuleRunsForRules(
    ctx,
    rules.map((rule) => rule.id)
  );

  return (
    <div className="grid min-w-0 gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black">{t("list.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("list.description")}</p>
        </div>
        <Link href="/dashboard/rules/new">
          <Button>{t("list.newRule")}</Button>
        </Link>
      </div>

      <FormMessage error={search.error} message={search.message} />

      {rules.length === 0 ? (
        <EmptyState description={t("list.emptyDescription")} title={t("list.empty")} />
      ) : (
        <RulesTable
          rules={rules.map((rule) => ({
            id: rule.id,
            name: rule.name,
            trigger: rule.trigger,
            enabled: rule.enabled,
            conditionsCount: countConditions(rule.conditions),
            actionsCount: countActions(rule.actions),
            runsCount: runCounts[rule.id] ?? 0
          }))}
        />
      )}
    </div>
  );
}
