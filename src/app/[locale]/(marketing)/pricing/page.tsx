import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { billingConfig, type BillingPlan } from "@/config/billing";
import { Button } from "@/components/ui/button";
import { getAuthContext } from "@/modules/auth/session";
import { createCheckoutAction } from "@/modules/billing/billing.actions";
import { getOwnerPlan } from "@/modules/billing/billing.service";
import { resolveBillingOwner } from "@/modules/billing/owner";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const t = await getTranslations("marketing.pricing");
  const context = await getAuthContext();
  const owner = context ? await resolveBillingOwner(context) : null;
  const currentPlan = owner ? await getOwnerPlan(owner) : null;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-12">
      <div className="flex flex-col justify-between gap-6 border-b border-border pb-8 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">
            {t("eyebrow")}
          </p>
          <h1 className="mt-4 text-4xl font-black">{t("title")}</h1>
          <p className="mt-3 max-w-2xl leading-7 text-muted">{t("description")}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/">{t("home")}</Link>
        </Button>
      </div>
      <section className="mt-8 grid gap-4 md:grid-cols-3">
        {(Object.values(billingConfig.plans) as BillingPlan[]).map((plan) => {
          const isCurrent = currentPlan === plan.key;

          return (
            <article
              className="flex flex-col rounded-lg border border-border bg-panel p-5 shadow-sm"
              key={plan.key}
            >
              <h2 className="text-xl font-black">{plan.name}</h2>
              <p className="mt-2 min-h-14 leading-7 text-muted">{plan.description}</p>
              <p className="mt-5 text-3xl font-black">
                ${(plan.priceMonthlyCents / 100).toFixed(0)}
                <span className="text-sm font-semibold text-muted"> {t("perMonth")}</span>
              </p>
              <dl className="mt-5 space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">{t("features.teamMembers")}</dt>
                  <dd className="font-semibold">{plan.features.teamMembers}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">{t("features.storage")}</dt>
                  <dd className="font-semibold">{plan.features.storageMb} MB</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">{t("features.credits")}</dt>
                  <dd className="font-semibold">{plan.features.credits}</dd>
                </div>
              </dl>

              <div className="mt-6">
                {isCurrent ? (
                  <span className="inline-flex w-full items-center justify-center rounded-md border border-border bg-panel-strong px-4 py-2 text-sm font-semibold">
                    {t("actions.currentPlan")}
                  </span>
                ) : !context ? (
                  <Button asChild className="w-full">
                    <Link
                      href={
                        plan.key === "free"
                          ? "/register"
                          : `/register?next=${encodeURIComponent("/settings/billing")}`
                      }
                    >
                      {plan.key === "free"
                        ? t("actions.getStarted")
                        : t("actions.signUpToSubscribe")}
                    </Link>
                  </Button>
                ) : plan.key === "free" ? (
                  <Button asChild className="w-full" variant="outline">
                    <Link href="/settings/billing">{t("actions.manageBilling")}</Link>
                  </Button>
                ) : owner === null ? (
                  <Button asChild className="w-full" variant="outline">
                    <Link href="/organizations/new">{t("actions.createOrganization")}</Link>
                  </Button>
                ) : plan.stripePriceIdMonthly ? (
                  <form action={createCheckoutAction} className="w-full">
                    <input name="planKey" type="hidden" value={plan.key} />
                    <input name="interval" type="hidden" value="monthly" />
                    <Button className="w-full" type="submit">
                      {t("actions.subscribe")}
                    </Button>
                  </form>
                ) : (
                  <Button className="w-full" disabled>
                    {t("actions.contactUs")}
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
