import { getTranslations } from "next-intl/server";

import { FormMessage } from "@/components/forms/form-message";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { billingConfig, type BillingPlan } from "@/config/billing";
import { can, requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import {
  createCheckoutAction,
  createPortalAction,
  purchaseCreditsAction
} from "@/modules/billing/billing.actions";
import { getOwnerPlan, hasStripeCustomer } from "@/modules/billing/billing.service";
import { getCreditBalance } from "@/modules/billing/credits.service";
import { requireBillingOwner } from "@/modules/billing/owner";
import { checkUsageLimit, currentUsagePeriod } from "@/modules/billing/usage.service";
import { getMembership } from "@/modules/organizations/organizations.service";

export const dynamic = "force-dynamic";

export default async function BillingSettingsPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  requireFeature("billing");
  const context = await requireUser("/settings/billing");
  const owner = await requireBillingOwner(context);
  const t = await getTranslations("settings");

  const [params, currentPlan, creditBalance, teamMembersUsage, membership] = await Promise.all([
    searchParams,
    getOwnerPlan(owner),
    getCreditBalance(owner),
    checkUsageLimit(owner, "teamMembers", currentUsagePeriod("monthly")),
    owner.type === "organization" ? getMembership(owner.id, context.user.id) : Promise.resolve(null)
  ]);

  const canManageBilling =
    owner.type === "user" ||
    Boolean(membership && can(membership.role, "organization.billing.manage"));
  const showPortalButton = canManageBilling && (await hasStripeCustomer(owner));

  const otherPlans = (Object.values(billingConfig.plans) as BillingPlan[]).filter(
    (plan) => plan.key !== currentPlan
  );

  return (
    <div className="grid w-full gap-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-3xl font-black">{t("billing.title")}</h1>
          <p className="mt-1 text-sm text-muted">
            {owner.type === "organization"
              ? t("billing.organizationManaged")
              : t("billing.manageSubscription")}
          </p>
        </div>
        {showPortalButton ? (
          <form action={createPortalAction}>
            <Button type="submit" variant="outline">
              {t("billing.manageBilling")}
            </Button>
          </form>
        ) : null}
      </div>

      <FormMessage error={params.error} message={params.message} />

      {!canManageBilling ? (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted">
          {t("billing.noPermission")}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <CardTitle>{t("billing.currentPlan")}</CardTitle>
                <CardDescription>
                  {t("billing.teamMembersUsed", {
                    used: teamMembersUsage.used,
                    limit: teamMembersUsage.limit
                  })}
                </CardDescription>
              </div>
              <Badge variant="accent">{billingConfig.plans[currentPlan].name}</Badge>
            </div>
          </CardHeader>
          {canManageBilling && otherPlans.length > 0 ? (
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2">
                {otherPlans.map((plan) => (
                  <div className="rounded-md border border-border p-4" key={plan.key}>
                    <p className="font-semibold">{plan.name}</p>
                    <p className="mt-1 text-sm text-muted">
                      {t("billing.pricePerMonth", {
                        price: (plan.priceMonthlyCents / 100).toFixed(0)
                      })}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {plan.stripePriceIdMonthly ? (
                        <form action={createCheckoutAction}>
                          <input name="planKey" type="hidden" value={plan.key} />
                          <input name="interval" type="hidden" value="monthly" />
                          <Button size="sm" type="submit">
                            {t("billing.switchMonthly")}
                          </Button>
                        </form>
                      ) : null}
                      {plan.stripePriceIdYearly ? (
                        <form action={createCheckoutAction}>
                          <input name="planKey" type="hidden" value={plan.key} />
                          <input name="interval" type="hidden" value="yearly" />
                          <Button size="sm" type="submit" variant="outline">
                            {t("billing.switchYearly")}
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("billing.credits")}</CardTitle>
            <CardDescription>{t("billing.currentBalance")}</CardDescription>
            <p className="text-3xl font-black tabular-nums">{creditBalance}</p>
          </CardHeader>
          {canManageBilling ? (
            <CardContent className="grid gap-3">
              {billingConfig.creditPacks.map((pack) => (
                <form action={purchaseCreditsAction} key={pack.key}>
                  <input name="packKey" type="hidden" value={pack.key} />
                  <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                    <div>
                      <p className="font-semibold">{pack.name}</p>
                      <p className="text-sm text-muted">
                        {t("billing.creditsAndPrice", {
                          credits: pack.credits,
                          price: (pack.priceCents / 100).toFixed(2)
                        })}
                      </p>
                    </div>
                    <Button disabled={!pack.stripePriceId} size="sm" type="submit">
                      {t("billing.buy")}
                    </Button>
                  </div>
                </form>
              ))}
            </CardContent>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
