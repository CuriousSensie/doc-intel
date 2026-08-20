import Link from "next/link";

import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { AuthCard } from "@/components/layout/auth-card";
import { Button } from "@/components/ui/button";
import { forgotPasswordAction } from "@/modules/auth/auth.actions";
import { requireGuest } from "@/modules/auth/session";

export default async function ForgotPasswordPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireGuest();
  const params = await searchParams;

  return (
    <AuthCard
      eyebrow="Account recovery"
      title="Reset password"
      description="Enter your email and we will send a secure reset link."
      footer={
        <Link className="font-semibold text-foreground" href="/login">
          Back to login
        </Link>
      }
    >
      <form action={forgotPasswordAction} className="grid gap-4">
        <FormMessage error={params.error} />
        <TextField autoComplete="email" label="Email" name="email" required type="email" />
        <Button type="submit">Send reset link</Button>
      </form>
    </AuthCard>
  );
}
