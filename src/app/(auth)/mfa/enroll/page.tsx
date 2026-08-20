import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { AuthCard } from "@/components/layout/auth-card";
import { Button } from "@/components/ui/button";
import { verifyMfaEnrollmentAction } from "@/modules/auth/auth.actions";
import { requireUser } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

export default async function MfaEnrollPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; factorId?: string; qr?: string; secret?: string }>;
}) {
  await requireUser("/mfa/enroll");
  const params = await searchParams;

  return (
    <AuthCard
      eyebrow="Two-factor authentication"
      title="Enable MFA"
      description="Scan the QR code with your authenticator app, then enter the generated code."
    >
      <form action={verifyMfaEnrollmentAction} className="grid gap-4">
        <FormMessage error={params.error} />
        <input name="factorId" type="hidden" value={params.factorId ?? ""} />
        {params.qr ? (
          // Supabase returns an SVG data URI for TOTP enrollment.
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="Authenticator QR code" className="mx-auto size-48 rounded-md border border-border" src={params.qr} />
        ) : null}
        {params.secret ? (
          <p className="rounded-md border border-border bg-panel-strong p-3 font-mono text-xs">
            {params.secret}
          </p>
        ) : null}
        <TextField
          autoComplete="one-time-code"
          inputMode="numeric"
          label="6-digit code"
          maxLength={6}
          name="code"
          pattern="[0-9]{6}"
          required
        />
        <Button type="submit">Enable MFA</Button>
      </form>
    </AuthCard>
  );
}
