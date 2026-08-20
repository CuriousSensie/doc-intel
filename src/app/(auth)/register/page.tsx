import Link from "next/link";

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

  return (
    <AuthCard
      eyebrow="Create account"
      title="Register"
      description="Create a verified Supabase Auth account and profile."
      footer={
        <>
          Already registered?{" "}
          <Link className="font-semibold text-foreground" href="/login">
            Login
          </Link>
          .
        </>
      }
    >
      <form action={registerAction} className="grid gap-4">
        <FormMessage error={params.error} />
        <input name="next" type="hidden" value={params.next ?? "/onboarding"} />
        <TextField autoComplete="name" label="Name" name="name" required />
        <TextField autoComplete="email" label="Email" name="email" required type="email" />
        <TextField
          autoComplete="new-password"
          hint="Use at least 8 characters with uppercase, lowercase, and a number."
          label="Password"
          name="password"
          required
          type="password"
        />
        <TextField
          autoComplete="new-password"
          label="Confirm password"
          name="confirmPassword"
          required
          type="password"
        />
        <label className="flex items-start gap-3 text-sm text-muted">
          <input className="mt-1" name="terms" required type="checkbox" />
          <span>
            I accept the{" "}
            <Link className="font-semibold text-foreground" href="/terms">
              terms
            </Link>{" "}
            and{" "}
            <Link className="font-semibold text-foreground" href="/privacy">
              privacy policy
            </Link>
            .
          </span>
        </label>
        <Button type="submit">Create account</Button>
      </form>
    </AuthCard>
  );
}
