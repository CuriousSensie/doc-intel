import { ArrowRight, Building2, CreditCard, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { appConfig } from "@/config/app";
import { billingOwnerType } from "@/config/billing";
import { moduleMatrix } from "@/config/modules";
import { Button } from "@/components/ui/button";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";

export default async function HomePage() {
  const t = await getTranslations("marketing");

  const pillars = [
    {
      icon: LockKeyhole,
      title: t("home.pillars.auth.title"),
      body: t("home.pillars.auth.body")
    },
    {
      icon: Building2,
      title: t("home.pillars.organizations.title"),
      body: t("home.pillars.organizations.body")
    },
    {
      icon: CreditCard,
      title: t("home.pillars.billing.title"),
      body: t("home.pillars.billing.body")
    },
    {
      icon: Mail,
      title: t("home.pillars.messaging.title"),
      body: t("home.pillars.messaging.body")
    },
    {
      icon: ShieldCheck,
      title: t("home.pillars.guardrails.title"),
      body: t("home.pillars.guardrails.body")
    }
  ];

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
                {t("home.nav.login")}
              </Link>
              <Button asChild size="sm">
                <Link href="/register">{t("home.nav.start")}</Link>
              </Button>
              <LocaleSwitcher />
            </nav>
          </header>

          <div className="max-w-3xl">
            <p className="mb-5 inline-flex rounded-full border border-border bg-panel px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted">
              {t("home.hero.eyebrow")}
            </p>
            <h1 className="text-balance text-5xl font-black leading-[0.95] tracking-normal sm:text-6xl lg:text-7xl">
              {t("home.hero.title")}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted">{t("home.hero.description")}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/dashboard">
                  {t("home.hero.openDashboard")}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/pricing">{t("home.hero.viewPricing")}</Link>
              </Button>
            </div>
          </div>

          <dl className="grid grid-cols-3 gap-3 border-y border-border py-5 text-sm">
            <div>
              <dt className="text-muted">{t("home.stats.defaultBilling")}</dt>
              <dd className="mt-1 font-semibold capitalize">{billingOwnerType}</dd>
            </div>
            <div>
              <dt className="text-muted">{t("home.stats.modules")}</dt>
              <dd className="mt-1 font-semibold">{moduleMatrix.length}</dd>
            </div>
            <div>
              <dt className="text-muted">{t("home.stats.stack")}</dt>
              <dd className="mt-1 font-semibold">{t("home.stats.stackValue")}</dd>
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
