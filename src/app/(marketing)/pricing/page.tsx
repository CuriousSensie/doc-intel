import Link from "next/link";

import { billingConfig } from "@/config/billing";
import { Button } from "@/components/ui/button";

export default function PricingPage() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-12">
      <div className="flex flex-col justify-between gap-6 border-b border-border pb-8 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">
            Billing shell
          </p>
          <h1 className="mt-4 text-4xl font-black">Pricing</h1>
          <p className="mt-3 max-w-2xl leading-7 text-muted">
            Plans are configuration-driven. Stripe checkout and entitlement enforcement are
            implemented in the billing branch.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/">Home</Link>
        </Button>
      </div>
      <section className="mt-8 grid gap-4 md:grid-cols-3">
        {Object.values(billingConfig.plans).map((plan) => (
          <article className="rounded-lg border border-border bg-panel p-5 shadow-sm" key={plan.key}>
            <h2 className="text-xl font-black">{plan.name}</h2>
            <p className="mt-2 min-h-14 leading-7 text-muted">{plan.description}</p>
            <p className="mt-5 text-3xl font-black">
              ${(plan.priceMonthlyCents / 100).toFixed(0)}
              <span className="text-sm font-semibold text-muted"> / month</span>
            </p>
            <dl className="mt-5 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Projects</dt>
                <dd className="font-semibold">{plan.features.projects}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Storage</dt>
                <dd className="font-semibold">{plan.features.storageMb} MB</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Credits</dt>
                <dd className="font-semibold">{plan.features.credits}</dd>
              </div>
            </dl>
          </article>
        ))}
      </section>
    </main>
  );
}
