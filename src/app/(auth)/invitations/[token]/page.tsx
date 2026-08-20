import Link from "next/link";

import { AuthCard } from "@/components/layout/auth-card";
import { FormMessage } from "@/components/forms/form-message";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/modules/auth/auth.actions";
import { getCurrentUser } from "@/modules/auth/session";
import { acceptInvitationAction } from "@/modules/organizations/organizations.actions";
import { getInvitationPreview } from "@/modules/organizations/organizations.service";

export const dynamic = "force-dynamic";

export default async function InvitationPage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ token }, search, user] = await Promise.all([params, searchParams, getCurrentUser()]);
  const invitation = await getInvitationPreview(token);

  if (!invitation) {
    return (
      <AuthCard
        description="This invitation link is invalid. Ask an admin to send a new one."
        eyebrow="Invitation"
        title="Invitation not found"
      >
        <Link className="text-sm font-semibold text-foreground" href="/">
          Return home
        </Link>
      </AuthCard>
    );
  }

  if (invitation.revoked_at) {
    return (
      <AuthCard
        description="This invitation has been revoked. Ask an admin to send a new one."
        eyebrow="Invitation"
        title="Invitation revoked"
      >
        <Link className="text-sm font-semibold text-foreground" href="/">
          Return home
        </Link>
      </AuthCard>
    );
  }

  if (invitation.accepted_at) {
    return (
      <AuthCard
        description="This invitation has already been used."
        eyebrow="Invitation"
        title="Already accepted"
      >
        <Link className="text-sm font-semibold text-foreground" href="/login">
          Sign in
        </Link>
      </AuthCard>
    );
  }

  if (new Date(invitation.expires_at) <= new Date()) {
    return (
      <AuthCard
        description="This invitation has expired. Ask an admin to send a new one."
        eyebrow="Invitation"
        title="Invitation expired"
      >
        <Link className="text-sm font-semibold text-foreground" href="/">
          Return home
        </Link>
      </AuthCard>
    );
  }

  const next = `/invitations/${token}`;

  if (!user) {
    return (
      <AuthCard
        description={`Sign in or create an account with ${invitation.email} to accept this invitation.`}
        eyebrow="Invitation"
        title={`Join ${invitation.organization_name}`}
      >
        <div className="grid gap-3">
          <Button asChild>
            <Link href={`/register?next=${encodeURIComponent(next)}`}>Create account</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  if (user.email?.toLowerCase() !== invitation.email.toLowerCase()) {
    return (
      <AuthCard
        description={`This invitation was sent to ${invitation.email}. You are signed in as ${user.email}.`}
        eyebrow="Invitation"
        title="Wrong account"
      >
        <form action={logoutAction}>
          <Button type="submit" variant="outline">
            Sign out and try again
          </Button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      description={`You have been invited as ${invitation.role} of ${invitation.organization_name}.`}
      eyebrow="Invitation"
      title={`Join ${invitation.organization_name}`}
    >
      <FormMessage error={search.error} />
      <form action={acceptInvitationAction} className="mt-4 grid gap-4">
        <input name="token" type="hidden" value={token} />
        <Button type="submit">Accept invitation</Button>
      </form>
    </AuthCard>
  );
}
