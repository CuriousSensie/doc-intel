import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { AuthCard } from "@/components/layout/auth-card";
import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/modules/auth/auth.actions";
import { getCurrentUser } from "@/modules/auth/session";
import {
  acceptInvitationAction,
  acceptInvitationSignupAction
} from "@/modules/organizations/organizations.actions";
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
  const t = await getTranslations("auth");

  if (!invitation) {
    return (
      <AuthCard
        description={t("invitations.notFound.description")}
        eyebrow={t("invitations.eyebrow")}
        title={t("invitations.notFound.title")}
      >
        <Link className="text-sm font-semibold text-foreground" href="/">
          {t("invitations.notFound.returnHome")}
        </Link>
      </AuthCard>
    );
  }

  if (invitation.revoked_at) {
    return (
      <AuthCard
        description={t("invitations.revoked.description")}
        eyebrow={t("invitations.eyebrow")}
        title={t("invitations.revoked.title")}
      >
        <Link className="text-sm font-semibold text-foreground" href="/">
          {t("invitations.revoked.returnHome")}
        </Link>
      </AuthCard>
    );
  }

  if (invitation.accepted_at) {
    return (
      <AuthCard
        description={t("invitations.alreadyAccepted.description")}
        eyebrow={t("invitations.eyebrow")}
        title={t("invitations.alreadyAccepted.title")}
      >
        <Link className="text-sm font-semibold text-foreground" href="/login">
          {t("invitations.alreadyAccepted.signIn")}
        </Link>
      </AuthCard>
    );
  }

  if (new Date(invitation.expires_at) <= new Date()) {
    return (
      <AuthCard
        description={t("invitations.expired.description")}
        eyebrow={t("invitations.eyebrow")}
        title={t("invitations.expired.title")}
      >
        <Link className="text-sm font-semibold text-foreground" href="/">
          {t("invitations.expired.returnHome")}
        </Link>
      </AuthCard>
    );
  }

  const next = `/invitations/${token}`;

  if (!user) {
    return (
      <AuthCard
        description={t("invitations.join.descriptionGuest", { email: invitation.email })}
        eyebrow={t("invitations.eyebrow")}
        title={t("invitations.join.title", { organizationName: invitation.organization_name })}
      >
        <FormMessage error={search.error} />
        {/* Name and email come from the invitation itself (set by the org admin) — no email
            verification step, since the invite link already proved the inbox. Only a
            password is collected here. */}
        <form action={acceptInvitationSignupAction} className="mt-4 grid gap-4">
          <input name="token" type="hidden" value={token} />
          <TextField disabled label={t("invitations.join.nameLabel")} name="name" value={invitation.invitee_name ?? ""} />
          <TextField disabled label={t("invitations.join.emailLabel")} name="email" value={invitation.email} />
          <TextField
            autoComplete="new-password"
            label={t("invitations.join.passwordLabel")}
            name="password"
            required
            type="password"
          />
          <TextField
            autoComplete="new-password"
            label={t("invitations.join.confirmPasswordLabel")}
            name="confirmPassword"
            required
            type="password"
          />
          <Button type="submit">{t("invitations.join.createAccountAndJoin")}</Button>
        </form>
        <p className="mt-4 text-sm text-muted">
          {t("invitations.join.alreadyHaveAccount")}{" "}
          <Link className="font-semibold text-foreground" href={`/login?next=${encodeURIComponent(next)}`}>
            {t("invitations.join.signIn")}
          </Link>
        </p>
      </AuthCard>
    );
  }

  if (user.email?.toLowerCase() !== invitation.email.toLowerCase()) {
    return (
      <AuthCard
        description={t("invitations.wrongAccount.description", {
          invitationEmail: invitation.email,
          userEmail: user.email ?? ""
        })}
        eyebrow={t("invitations.eyebrow")}
        title={t("invitations.wrongAccount.title")}
      >
        <form action={logoutAction}>
          <Button type="submit" variant="outline">
            {t("invitations.wrongAccount.signOut")}
          </Button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      description={t("invitations.join.descriptionMember", {
        role: invitation.role,
        organizationName: invitation.organization_name
      })}
      eyebrow={t("invitations.eyebrow")}
      title={t("invitations.join.title", { organizationName: invitation.organization_name })}
    >
      <FormMessage error={search.error} />
      <form action={acceptInvitationAction} className="mt-4 grid gap-4">
        <input name="token" type="hidden" value={token} />
        <Button type="submit">{t("invitations.join.accept")}</Button>
      </form>
    </AuthCard>
  );
}
