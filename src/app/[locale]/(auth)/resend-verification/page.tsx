import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { AuthCard } from "@/components/layout/auth-card";
import { Button } from "@/components/ui/button";
import { resendVerificationAction } from "@/modules/auth/auth.actions";
import { requireGuest } from "@/modules/auth/session";

export default async function ResendVerificationPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireGuest();
  const params = await searchParams;
  const t = await getTranslations("auth");

  return (
    <AuthCard
      eyebrow={t("resendVerification.eyebrow")}
      title={t("resendVerification.title")}
      description={t("resendVerification.description")}
      footer={
        <Link className="font-semibold text-foreground" href="/login">
          {t("resendVerification.footer.backToLogin")}
        </Link>
      }
    >
      <form action={resendVerificationAction} className="grid gap-4">
        <FormMessage error={params.error} />
        <TextField autoComplete="email" label={t("resendVerification.emailLabel")} name="email" required type="email" />
        <Button type="submit">{t("resendVerification.submit")}</Button>
      </form>
    </AuthCard>
  );
}
