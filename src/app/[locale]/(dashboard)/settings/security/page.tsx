import { getTranslations } from "next-intl/server";

import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import {
  changePasswordAction,
  disableMfaAction,
  logoutAction,
  startMfaEnrollmentAction
} from "@/modules/auth/auth.actions";
import { requireUser } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  await requireUser("/settings/security");
  const [params, supabase, t] = await Promise.all([
    searchParams,
    createClient(),
    getTranslations("settings")
  ]);
  const factors = await supabase.auth.mfa.listFactors();
  const totpFactors = factors.data?.totp ?? [];

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <h1 className="text-3xl font-black">{t("security.title")}</h1>
        <div className="mt-6">
          <FormMessage error={params.error} message={params.message} />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <h2 className="text-xl font-black">{t("security.changePassword")}</h2>
        <form action={changePasswordAction} className="mt-5 grid gap-4">
          <TextField label={t("security.newPassword")} name="password" required type="password" />
          <TextField
            label={t("security.confirmPassword")}
            name="confirmPassword"
            required
            type="password"
          />
          <Button type="submit">{t("security.changePassword")}</Button>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <h2 className="text-xl font-black">{t("security.mfa")}</h2>
        <p className="mt-2 leading-7 text-muted">{t("security.mfaDescription")}</p>
        <div className="mt-5 grid gap-3">
          {totpFactors.length === 0 ? (
            <form action={startMfaEnrollmentAction}>
              <Button type="submit">{t("security.enableMfa")}</Button>
            </form>
          ) : (
            totpFactors.map((factor) => (
              <form
                action={disableMfaAction}
                className="flex items-center justify-between gap-4"
                key={factor.id}
              >
                <input name="factorId" type="hidden" value={factor.id} />
                <span className="text-sm font-semibold">
                  {factor.friendly_name ?? t("security.authenticatorAppFallback")}
                </span>
                <Button type="submit" variant="outline">
                  {t("security.disable")}
                </Button>
              </form>
            ))
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <h2 className="text-xl font-black">{t("security.session")}</h2>
        <form action={logoutAction} className="mt-5">
          <Button type="submit" variant="outline">
            {t("security.logout")}
          </Button>
        </form>
      </section>
    </div>
  );
}
