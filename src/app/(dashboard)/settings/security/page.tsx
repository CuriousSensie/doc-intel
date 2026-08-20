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
  const [params, supabase] = await Promise.all([searchParams, createClient()]);
  const factors = await supabase.auth.mfa.listFactors();
  const totpFactors = factors.data?.totp ?? [];

  return (
    <main className="mx-auto grid min-h-screen max-w-3xl gap-5 px-6 py-10">
      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Settings</p>
        <h1 className="mt-3 text-3xl font-black">Security</h1>
        <div className="mt-6">
          <FormMessage error={params.error} message={params.message} />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <h2 className="text-xl font-black">Change password</h2>
        <form action={changePasswordAction} className="mt-5 grid gap-4">
          <TextField label="New password" name="password" required type="password" />
          <TextField label="Confirm password" name="confirmPassword" required type="password" />
          <Button type="submit">Change password</Button>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <h2 className="text-xl font-black">Multi-factor authentication</h2>
        <p className="mt-2 leading-7 text-muted">
          TOTP factors are managed through Supabase Auth and can be required for sensitive actions.
        </p>
        <div className="mt-5 grid gap-3">
          {totpFactors.length === 0 ? (
            <form action={startMfaEnrollmentAction}>
              <Button type="submit">Enable MFA</Button>
            </form>
          ) : (
            totpFactors.map((factor) => (
              <form action={disableMfaAction} className="flex items-center justify-between gap-4" key={factor.id}>
                <input name="factorId" type="hidden" value={factor.id} />
                <span className="text-sm font-semibold">{factor.friendly_name ?? "Authenticator app"}</span>
                <Button type="submit" variant="outline">
                  Disable
                </Button>
              </form>
            ))
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <h2 className="text-xl font-black">Session</h2>
        <form action={logoutAction} className="mt-5">
          <Button type="submit" variant="outline">
            Logout
          </Button>
        </form>
      </section>
    </main>
  );
}
