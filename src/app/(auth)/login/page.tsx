import Link from "next/link";

import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { AuthCard } from "@/components/layout/auth-card";
import { Button } from "@/components/ui/button";
import { loginAction, oauthAction } from "@/modules/auth/auth.actions";
import { requireGuest } from "@/modules/auth/session";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; message?: string; next?: string }>;
}) {
  await requireGuest();
  const params = await searchParams;

  return (
    <AuthCard
      eyebrow="Welcome back"
      title="Login"
      description="Access your dashboard with email/password or an enabled OAuth provider."
      footer={
        <>
          No account?{" "}
          <Link className="font-semibold text-foreground" href="/register">
            Create one
          </Link>
          . Forgot your password?{" "}
          <Link className="font-semibold text-foreground" href="/forgot-password">
            Reset it
          </Link>
          .
        </>
      }
    >
      <div className="grid gap-4">
        <FormMessage error={params.error} message={params.message} />
        <form action={loginAction} className="grid gap-4">
          <input name="next" type="hidden" value={params.next ?? "/dashboard"} />
          <TextField autoComplete="email" label="Email" name="email" required type="email" />
          <TextField
            autoComplete="current-password"
            label="Password"
            name="password"
            required
            type="password"
          />
          <Button type="submit">Login</Button>
        </form>
        <div className="grid grid-cols-2 gap-3">
          <form action={oauthAction}>
            <input name="provider" type="hidden" value="google" />
            <input name="next" type="hidden" value={params.next ?? "/dashboard"} />
            <Button className="w-full" type="submit" variant="outline">
              Google
            </Button>
          </form>
          <form action={oauthAction}>
            <input name="provider" type="hidden" value="github" />
            <input name="next" type="hidden" value={params.next ?? "/dashboard"} />
            <Button className="w-full" type="submit" variant="outline">
              GitHub
            </Button>
          </form>
        </div>
        <Link className="text-sm font-semibold text-muted hover:text-foreground" href="/resend-verification">
          Resend verification email
        </Link>
      </div>
    </AuthCard>
  );
}
