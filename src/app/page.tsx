import Link from "next/link";
import { ArrowRight, Building2, CreditCard, LockKeyhole, Mail, ShieldCheck } from "lucide-react";

import { appConfig } from "@/config/app";
import { billingOwnerType } from "@/config/billing";
import { moduleMatrix } from "@/config/modules";
import { Button } from "@/components/ui/button";

const pillars = [
  {
    icon: LockKeyhole,
    title: "Auth and account security",
    body: "Supabase Auth, SSR sessions, route protection, profile settings, MFA-ready flows, and safe account deletion."
  },
  {
    icon: Building2,
    title: "Organizations when needed",
    body: "User-first by default, with optional workspaces, RBAC, invitations, and organization billing for B2B products."
  },
  {
    icon: CreditCard,
    title: "Billing and entitlements",
    body: "Stripe Checkout, Customer Portal, subscriptions, one-time credits, usage limits, and idempotent webhooks."
  },
  {
    icon: Mail,
    title: "Transactional messaging",
    body: "Pluggable SMTP/console email provider abstraction, React Email templates, notification preferences, and safe development email mode."
  },
  {
    icon: ShieldCheck,
    title: "Production guardrails",
    body: "RLS, typed config, structured errors, audit logs, file ownership, testing, and documentation from day one."
  }
];

export default function HomePage() {
  return (
    <main id="main" className="min-h-screen">
      <section className="mx-auto grid w-full max-w-7xl gap-10 px-6 py-8 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:px-10 lg:py-12">
        <div className="flex min-h-[calc(100vh-6rem)] flex-col justify-between gap-12">
          <header className="flex items-center justify-between gap-4">
            <Link className="text-sm font-semibold tracking-wide" href="/">
              {appConfig.name}
            </Link>
            <nav aria-label="Primary" className="flex items-center gap-2 text-sm text-muted">
              <Link className="rounded-md px-3 py-2 hover:text-foreground" href="/login">
                Login
              </Link>
              <Button asChild size="sm">
                <Link href="/register">Start</Link>
              </Button>
            </nav>
          </header>

          <div className="max-w-3xl">
            <p className="mb-5 inline-flex rounded-full border border-border bg-panel px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted">
              Production SaaS foundation
            </p>
            <h1 className="text-balance text-5xl font-black leading-[0.95] tracking-normal sm:text-6xl lg:text-7xl">
              Build the product, not the same plumbing again.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted">
              A serious full-stack SaaS starter for authentication, billing, organizations,
              emails, files, admin tooling, and the operational paths every product needs.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/dashboard">
                  Open dashboard
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/pricing">View pricing shell</Link>
              </Button>
            </div>
          </div>

          <dl className="grid grid-cols-3 gap-3 border-y border-border py-5 text-sm">
            <div>
              <dt className="text-muted">Default billing</dt>
              <dd className="mt-1 font-semibold capitalize">{billingOwnerType}</dd>
            </div>
            <div>
              <dt className="text-muted">Modules</dt>
              <dd className="mt-1 font-semibold">{moduleMatrix.length}</dd>
            </div>
            <div>
              <dt className="text-muted">Stack</dt>
              <dd className="mt-1 font-semibold">Next.js + Supabase</dd>
            </div>
          </dl>
        </div>

        <div className="grid content-center gap-3 lg:min-h-[calc(100vh-6rem)]">
          {pillars.map((pillar, index) => {
            const Icon = pillar.icon;

            return (
              <article
                className="grid grid-cols-[auto_1fr] gap-4 rounded-lg border border-border bg-panel/78 p-5 shadow-sm backdrop-blur"
                key={pillar.title}
              >
                <div className="flex size-11 items-center justify-center rounded-md bg-foreground text-background">
                  <Icon className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-muted">0{index + 1}</span>
                    <h2 className="text-base font-bold">{pillar.title}</h2>
                  </div>
                  <p className="mt-2 leading-7 text-muted">{pillar.body}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
