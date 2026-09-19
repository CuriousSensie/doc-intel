import { getTranslations } from "next-intl/server";

import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="grid w-full gap-5">
      <div>
        <h1 className="text-3xl font-black">{t("security.title")}</h1>
        <div className="mt-3 max-w-2xl">
          <FormMessage error={params.error} message={params.message} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>{t("security.changePassword")}</CardTitle>
            <CardDescription>{t("security.passwordDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={changePasswordAction} className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label={t("security.newPassword")}
                  name="password"
                  required
                  type="password"
                />
                <TextField
                  label={t("security.confirmPassword")}
                  name="confirmPassword"
                  required
                  type="password"
                />
              </div>
              <Button className="justify-self-start" type="submit">
                {t("security.changePassword")}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="grid gap-5">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>{t("security.mfa")}</CardTitle>
                <Badge variant={totpFactors.length === 0 ? "muted" : "accent"}>
                  {totpFactors.length === 0 ? t("security.disabled") : t("security.enabled")}
                </Badge>
              </div>
              <CardDescription>{t("security.mfaDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {totpFactors.length === 0 ? (
                <form action={startMfaEnrollmentAction}>
                  <Button type="submit">{t("security.enableMfa")}</Button>
                </form>
              ) : (
                totpFactors.map((factor) => (
                  <form
                    action={disableMfaAction}
                    className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2"
                    key={factor.id}
                  >
                    <input name="factorId" type="hidden" value={factor.id} />
                    <span className="truncate text-sm font-semibold">
                      {factor.friendly_name ?? t("security.authenticatorAppFallback")}
                    </span>
                    <Button size="sm" type="submit" variant="outline">
                      {t("security.disable")}
                    </Button>
                  </form>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("security.session")}</CardTitle>
              <CardDescription>{t("security.sessionDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={logoutAction}>
                <Button type="submit" variant="outline">
                  {t("security.logout")}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
