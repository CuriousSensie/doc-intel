import Link from "next/link";

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

  return (
    <AuthCard
      eyebrow="Email verification"
      title="Resend verification"
      description="Request a fresh account verification email."
      footer={
        <Link className="font-semibold text-foreground" href="/login">
          Back to login
        </Link>
      }
    >
      <form action={resendVerificationAction} className="grid gap-4">
        <FormMessage error={params.error} />
        <TextField autoComplete="email" label="Email" name="email" required type="email" />
        <Button type="submit">Send verification email</Button>
      </form>
    </AuthCard>
  );
}
