import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthorizationError } from "@/lib/errors";
import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { getMembership } from "@/modules/organizations/organizations.service";
import { triggerMessageKey } from "@/modules/rules/rules.schemas";
import { listRules } from "@/modules/rules/rules.service";

export const dynamic = "force-dynamic";

export default async function RulesListPage() {
  requireFeature("rules");
  const { user } = await requireUser("/dashboard/rules");
  const ctx = await buildRequestContext();
  const t = await getTranslations("rules");

  const membership = await getMembership(ctx.orgId, user.id);
  if (membership?.role !== "owner" && membership?.role !== "admin") {
    throw new AuthorizationError(t("authorization.manageOnly"));
  }

  const rules = await listRules(ctx);

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black">{t("list.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("list.description")}</p>
        </div>
        <Link href="/dashboard/rules/new">
          <Button>{t("list.newRule")}</Button>
        </Link>
      </div>

      {rules.length === 0 ? (
        <EmptyState description={t("list.emptyDescription")} title={t("list.empty")} />
      ) : (
        <div className="grid gap-3">
          {rules.map((rule) => (
            <Link href={`/dashboard/rules/${rule.id}`} key={rule.id}>
              <Card className="transition-colors hover:bg-panel-strong/40">
                <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                  <CardTitle>{rule.name}</CardTitle>
                  <Badge variant={rule.enabled ? "accent" : "muted"}>
                    {rule.enabled ? t("list.enabled") : t("list.disabled")}
                  </Badge>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3 text-sm text-muted">
                  <span>{t("list.trigger", { trigger: t(`triggers.${triggerMessageKey(rule.trigger)}`) })}</span>
                  <span>{t("list.priority", { priority: rule.priority })}</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
