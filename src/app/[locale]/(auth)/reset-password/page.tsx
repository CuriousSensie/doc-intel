import { getTranslations } from "next-intl/server";

import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { AuthCard } from "@/components/layout/auth-card";
import { Button } from "@/components/ui/button";
import { resetPasswordAction } from "@/modules/auth/auth.actions";

export default async function ResetPasswordPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const t = await getTranslations("auth");

  return (
    <AuthCard
      eyebrow={t("resetPassword.eyebrow")}
      title={t("resetPassword.title")}
      description={t("resetPassword.description")}
    >
      <form action={resetPasswordAction} className="grid gap-4">
        <FormMessage error={params.error} />
        <TextField
          autoComplete="new-password"
          label={t("resetPassword.newPasswordLabel")}
          name="password"
          required
          type="password"
        />
        <TextField
          autoComplete="new-password"
          label={t("resetPassword.confirmPasswordLabel")}
          name="confirmPassword"
          required
          type="password"
        />
        <Button type="submit">{t("resetPassword.submit")}</Button>
      </form>
    </AuthCard>
  );
}
