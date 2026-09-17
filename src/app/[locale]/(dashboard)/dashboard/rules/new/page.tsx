import { getTranslations } from "next-intl/server";

import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { AuthorizationError } from "@/lib/errors";
import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { getMembership } from "@/modules/organizations/organizations.service";
import { createRuleFormAction } from "@/modules/rules/rules.actions";
import { RULE_TRIGGERS } from "@/modules/rules/rules.schemas";

export const dynamic = "force-dynamic";

const EXAMPLE_CONDITIONS = JSON.stringify(
  { all: [{ field: "document.type", op: "eq", value: "invoice" }] },
  null,
  2
);
const EXAMPLE_ACTIONS = JSON.stringify(
  [{ type: "add_tag", value: "auto-filed" }],
  null,
  2
);

export default async function NewRulePage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  requireFeature("rules");
  const [{ user }, search, t] = await Promise.all([
    requireUser("/dashboard/rules/new"),
    searchParams,
    getTranslations("rules")
  ]);
  const ctx = await buildRequestContext();

  const membership = await getMembership(ctx.orgId, user.id);
  if (membership?.role !== "owner" && membership?.role !== "admin") {
    throw new AuthorizationError(t("authorization.manageOnly"));
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <div>
        <h1 className="text-3xl font-black">{t("form.create")}</h1>
      </div>

      <FormMessage error={search.error} />

      <Card>
        <CardHeader>
          <CardTitle>{t("form.create")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createRuleFormAction} className="grid gap-4">
            <TextField label={t("form.nameLabel")} name="name" placeholder={t("form.namePlaceholder")} required />

            <label className="grid gap-2 text-sm font-semibold">
              <span>{t("form.triggerLabel")}</span>
              <select
                className="min-h-11 rounded-md border border-border bg-panel px-3 text-base font-normal outline-none transition focus:border-foreground focus:ring-2 focus:ring-foreground/15"
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
              defaultValue={100}
              hint={t("form.priorityHint")}
              label={t("form.priorityLabel")}
              name="priority"
              type="number"
            />

            <label className="grid gap-2 text-sm font-semibold">
              <span>{t("form.conditionsLabel")}</span>
              <Textarea
                className="min-h-40 font-mono text-xs"
                defaultValue={EXAMPLE_CONDITIONS}
                name="conditions"
                required
              />
              <span className="text-xs font-normal leading-5 text-muted">{t("form.conditionsHint")}</span>
            </label>

            <label className="grid gap-2 text-sm font-semibold">
              <span>{t("form.actionsLabel")}</span>
              <Textarea
                className="min-h-32 font-mono text-xs"
                defaultValue={EXAMPLE_ACTIONS}
                name="actions"
                required
              />
              <span className="text-xs font-normal leading-5 text-muted">{t("form.actionsHint")}</span>
            </label>

            <Button type="submit">{t("form.create")}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
