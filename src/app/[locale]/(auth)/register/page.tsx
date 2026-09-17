import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { AuthCard } from "@/components/layout/auth-card";
import { Button } from "@/components/ui/button";
import { registerAction } from "@/modules/auth/auth.actions";
import { requireGuest } from "@/modules/auth/session";

export default async function RegisterPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  await requireGuest();
  const params = await searchParams;
  const t = await getTranslations("auth");

  return (
    <AuthCard
      eyebrow={t("register.eyebrow")}
      title={t("register.title")}
      description={t("register.description")}
      footer={
        <>
          {t("register.footer.alreadyRegistered")}{" "}
          <Link className="font-semibold text-foreground" href="/login">
            {t("register.footer.login")}
          </Link>
          .
        </>
      }
    >
      <form action={registerAction} className="grid gap-4">
        <FormMessage error={params.error} />
        <input name="next" type="hidden" value={params.next ?? "/onboarding"} />
        <TextField autoComplete="name" label={t("register.nameLabel")} name="name" required />
        <TextField autoComplete="email" label={t("register.emailLabel")} name="email" required type="email" />
        <TextField
          autoComplete="new-password"
          hint={t("register.passwordHint")}
          label={t("register.passwordLabel")}
          name="password"
          required
          type="password"
        />
        <TextField
          autoComplete="new-password"
          label={t("register.confirmPasswordLabel")}
          name="confirmPassword"
          required
          type="password"
        />
        <label className="flex items-start gap-3 text-sm text-muted">
          <input className="mt-1" name="terms" required type="checkbox" />
          <span>
            {t("register.terms.prefix")}{" "}
            <Link className="font-semibold text-foreground" href="/terms">
              {t("register.terms.terms")}
            </Link>{" "}
            {t("register.terms.and")}{" "}
            <Link className="font-semibold text-foreground" href="/privacy">
              {t("register.terms.privacy")}
            </Link>
            .
          </span>
        </label>
        <Button type="submit">{t("register.submit")}</Button>
      </form>
    </AuthCard>
  );
}
