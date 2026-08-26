import { FormMessage } from "@/components/forms/form-message";
import { Button } from "@/components/ui/button";
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

  const [params, currentPlan, creditBalance, projectsUsage, membership] = await Promise.all([
    searchParams,
    getOwnerPlan(owner),
    getCreditBalance(owner),
    checkUsageLimit(owner, "projects", currentUsagePeriod("monthly")),
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
    <div className="mx-auto grid max-w-3xl gap-5">
      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <h1 className="text-3xl font-black">Billing</h1>
        <p className="mt-3 leading-7 text-muted">
          {owner.type === "organization"
            ? "Billing is managed for your organization."
            : "Manage your subscription and credits."}
        </p>
        <div className="mt-6">
          <FormMessage error={params.error} message={params.message} />
        </div>
        {!canManageBilling ? (
          <p className="mt-4 rounded-md border border-border bg-panel-strong px-3 py-2 text-sm text-muted">
            Only an organization owner or admin can manage billing. Contact one of them to make
            changes.
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-black">Current plan</h2>
            <p className="mt-1 text-2xl font-black">{billingConfig.plans[currentPlan].name}</p>
            <p className="mt-1 text-sm text-muted">
              {projectsUsage.used} / {projectsUsage.limit} projects used this period
            </p>
          </div>
          {showPortalButton ? (
            <form action={createPortalAction}>
              <Button type="submit" variant="outline">
                Manage billing
              </Button>
            </form>
          ) : null}
        </div>

        {canManageBilling && otherPlans.length > 0 ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {otherPlans.map((plan) => (
              <div className="rounded-md border border-border p-4" key={plan.key}>
                <p className="font-semibold">{plan.name}</p>
                <p className="mt-1 text-sm text-muted">
                  ${(plan.priceMonthlyCents / 100).toFixed(0)} / month
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {plan.stripePriceIdMonthly ? (
                    <form action={createCheckoutAction}>
                      <input name="planKey" type="hidden" value={plan.key} />
                      <input name="interval" type="hidden" value="monthly" />
                      <Button size="sm" type="submit">
                        Switch (monthly)
                      </Button>
                    </form>
                  ) : null}
                  {plan.stripePriceIdYearly ? (
                    <form action={createCheckoutAction}>
                      <input name="planKey" type="hidden" value={plan.key} />
                      <input name="interval" type="hidden" value="yearly" />
                      <Button size="sm" type="submit" variant="outline">
                        Switch (yearly)
                      </Button>
                    </form>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <h2 className="text-xl font-black">Credits</h2>
        <p className="mt-1 text-2xl font-black">{creditBalance}</p>
        <p className="mt-1 text-sm text-muted">Current credit balance</p>

        {canManageBilling ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {billingConfig.creditPacks.map((pack) => (
              <form action={purchaseCreditsAction} key={pack.key}>
                <input name="packKey" type="hidden" value={pack.key} />
                <div className="rounded-md border border-border p-4">
                  <p className="font-semibold">{pack.name}</p>
                  <p className="mt-1 text-sm text-muted">
                    {pack.credits} credits &middot; ${(pack.priceCents / 100).toFixed(2)}
                  </p>
                  <Button className="mt-3" disabled={!pack.stripePriceId} size="sm" type="submit">
                    Buy
                  </Button>
                </div>
              </form>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
