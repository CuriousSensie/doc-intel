import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

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
        <div className="grid gap-3">
          <Button asChild>
            <Link href={`/register?next=${encodeURIComponent(next)}`}>{t("invitations.join.createAccount")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/login?next=${encodeURIComponent(next)}`}>{t("invitations.join.signIn")}</Link>
          </Button>
        </div>
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
