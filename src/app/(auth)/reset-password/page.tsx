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

  return (
    <AuthCard
      eyebrow="Account recovery"
      title="Choose a new password"
      description="Your reset link creates a temporary session. Set a new password to continue."
    >
      <form action={resetPasswordAction} className="grid gap-4">
        <FormMessage error={params.error} />
        <TextField
          autoComplete="new-password"
          label="New password"
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
        <Button type="submit">Update password</Button>
      </form>
    </AuthCard>
  );
}
