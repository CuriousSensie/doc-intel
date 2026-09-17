import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { AuthCard } from "@/components/layout/auth-card";
import { Button } from "@/components/ui/button";
import { loginAction, oauthAction } from "@/modules/auth/auth.actions";
import { requireGuest } from "@/modules/auth/session";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; message?: string; next?: string }>;
}) {
  await requireGuest();
  const params = await searchParams;
  const t = await getTranslations("auth");

  return (
    <AuthCard
      eyebrow={t("login.eyebrow")}
      title={t("login.title")}
      description={t("login.description")}
      footer={
        <>
          {t("login.footer.noAccount")}{" "}
          <Link className="font-semibold text-foreground" href="/register">
            {t("login.footer.createOne")}
          </Link>
          . {t("login.footer.forgotPassword")}{" "}
          <Link className="font-semibold text-foreground" href="/forgot-password">
            {t("login.footer.resetIt")}
          </Link>
          .
        </>
      }
    >
      <div className="grid gap-4">
        <FormMessage error={params.error} message={params.message} />
        <form action={loginAction} className="grid gap-4">
          <input name="next" type="hidden" value={params.next ?? "/dashboard"} />
          <TextField autoComplete="email" label={t("login.emailLabel")} name="email" required type="email" />
          <TextField
            autoComplete="current-password"
            label={t("login.passwordLabel")}
            name="password"
            required
            type="password"
          />
          <Button type="submit">{t("login.submit")}</Button>
        </form>
        <div className="grid grid-cols-2 gap-3">
          <form action={oauthAction}>
            <input name="provider" type="hidden" value="google" />
            <input name="next" type="hidden" value={params.next ?? "/dashboard"} />
            <Button className="w-full" type="submit" variant="outline">
              {t("login.google")}
            </Button>
          </form>
          <form action={oauthAction}>
            <input name="provider" type="hidden" value="github" />
            <input name="next" type="hidden" value={params.next ?? "/dashboard"} />
            <Button className="w-full" type="submit" variant="outline">
              {t("login.github")}
            </Button>
          </form>
        </div>
        <Link className="text-sm font-semibold text-muted hover:text-foreground" href="/resend-verification">
          {t("login.resendVerification")}
        </Link>
      </div>
    </AuthCard>
  );
}
