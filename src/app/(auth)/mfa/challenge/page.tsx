import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { AuthCard } from "@/components/layout/auth-card";
import { Button } from "@/components/ui/button";
import { verifyMfaChallengeAction } from "@/modules/auth/auth.actions";
import { requireUser } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

export default async function MfaChallengePage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  await requireUser("/mfa/challenge");
  const params = await searchParams;

  return (
    <AuthCard
      eyebrow="Two-factor authentication"
      title="Enter authenticator code"
      description="Your account requires a second factor before continuing."
    >
      <form action={verifyMfaChallengeAction} className="grid gap-4">
        <FormMessage error={params.error} />
        <input name="next" type="hidden" value={params.next ?? "/dashboard"} />
        <TextField
          autoComplete="one-time-code"
          inputMode="numeric"
          label="6-digit code"
          maxLength={6}
          name="code"
          pattern="[0-9]{6}"
          required
        />
        <Button type="submit">Verify</Button>
      </form>
    </AuthCard>
  );
}
