import { getTranslations } from "next-intl/server";

import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { completeOnboardingAction } from "@/modules/auth/auth.actions";
import { requireUser } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ profile }, params] = await Promise.all([requireUser("/onboarding"), searchParams]);
  const t = await getTranslations("onboarding");

  return (
    <main className="mx-auto grid min-h-screen max-w-xl place-items-center px-6 py-10">
      <section className="w-full rounded-lg border border-border bg-panel p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</p>
        <h1 className="mt-3 text-3xl font-black">{t("title")}</h1>
        <p className="mt-3 leading-7 text-muted">{t("description")}</p>
        <form action={completeOnboardingAction} className="mt-6 grid gap-4">
          <FormMessage error={params.error} />
          <TextField defaultValue={profile?.name ?? ""} label={t("nameLabel")} name="name" required />
          <TextField
            defaultValue={profile?.timezone ?? "UTC"}
            label={t("timezoneLabel")}
            name="timezone"
            required
          />
          <TextField defaultValue={profile?.locale ?? "en"} label={t("localeLabel")} name="locale" required />
          <Button type="submit">{t("submit")}</Button>
        </form>
      </section>
    </main>
  );
}
