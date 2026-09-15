import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { absoluteUrl } from "@/lib/utils";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { getActiveOrganizationId } from "@/modules/organizations/active-organization";
import {
  deleteOrganizationAction,
  inviteMemberAction,
  leaveOrganizationAction,
  removeMemberAction,
  resendInvitationAction,
  revokeInvitationAction,
  transferOwnershipAction,
  updateMemberRoleAction,
  updateOrganizationAction
} from "@/modules/organizations/organizations.actions";
import {
  getMembership,
  getOrganization,
  listInvitations,
  listMembers
} from "@/modules/organizations/organizations.service";

export const dynamic = "force-dynamic";

async function EmptyTeamState() {
  const t = await getTranslations("settings");

  return (
    <div className="mx-auto max-w-3xl">
      <section className="w-full rounded-lg border border-border bg-panel p-6 text-center shadow-sm">
        <h1 className="text-3xl font-black">{t("team.title")}</h1>
        <p className="mt-3 leading-7 text-muted">{t("team.notInOrganization")}</p>
        <Button asChild className="mt-6">
          <Link href="/organizations/new">{t("team.createOrganization")}</Link>
        </Button>
      </section>
    </div>
  );
}

export default async function TeamSettingsPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; message?: string; invite?: string }>;
}) {
  requireFeature("organizations");
  const context = await requireUser("/settings/team");
  const t = await getTranslations("settings");
  const [params, activeOrganizationId] = await Promise.all([
    searchParams,
    getActiveOrganizationId(context.user.id)
  ]);

  if (!activeOrganizationId) {
    return <EmptyTeamState />;
  }

  const [organization, membership, members, invitations] = await Promise.all([
    getOrganization(activeOrganizationId),
    getMembership(activeOrganizationId, context.user.id),
    listMembers(activeOrganizationId),
    listInvitations(activeOrganizationId)
  ]);

  if (!organization || !membership) {
    return <EmptyTeamState />;
  }

  const canManage = membership.role === "owner" || membership.role === "admin";
  const isOwner = membership.role === "owner";
  const otherMembers = members.filter((member) => member.user_id !== context.user.id);
  const inviteLink = params.invite ? absoluteUrl(`/invitations/${params.invite}`) : null;
  const formatRole = (role: string) => {
    if (role === "admin") {
      return t("team.roleAdmin");
    }

    if (role === "read-only") {
      return t("team.roleReadOnly");
    }

    if (role === "owner") {
      return t("team.roleOwner");
    }

    return t("team.roleMember");
  };

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <h1 className="text-3xl font-black">{t("team.title")}</h1>
        <p className="mt-3 leading-7 text-muted">
          {t("team.manageDescription", { organization: organization.name })}
        </p>
        <div className="mt-6 grid gap-3">
          <FormMessage error={params.error} message={params.message} />
          {inviteLink ? (
            <p className="break-all rounded-md border border-border bg-panel-strong px-3 py-2 text-sm">
              {t("team.inviteLinkLabel")} <span className="font-mono">{inviteLink}</span>
            </p>
          ) : null}
        </div>
      </section>

      {canManage ? (
        <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
          <h2 className="text-xl font-black">{t("team.organizationSettings")}</h2>
          <form action={updateOrganizationAction} className="mt-5 grid gap-4">
            <input name="organizationId" type="hidden" value={organization.id} />
            <TextField
              defaultValue={organization.name}
              label={t("team.organizationNameLabel")}
              name="name"
              required
            />
            <TextField
              defaultValue={organization.logo_url ?? ""}
              hint={t("team.logoUrlHint")}
              label={t("team.logoUrlLabel")}
              name="logoUrl"
            />
            <Button className="justify-self-start" type="submit">
              {t("team.saveChanges")}
            </Button>
          </form>
        </section>
      ) : null}

      {canManage ? (
        <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
          <h2 className="text-xl font-black">{t("team.inviteMember")}</h2>
          <form
            action={inviteMemberAction}
            className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end"
          >
            <input name="organizationId" type="hidden" value={organization.id} />
            <TextField label={t("team.emailLabel")} name="email" required type="email" />
            <label className="grid gap-2 text-sm font-semibold">
              <span>{t("team.roleLabel")}</span>
              <select
                className="min-h-11 rounded-md border border-border bg-panel px-3 text-base font-normal outline-none transition focus:border-foreground focus:ring-2 focus:ring-foreground/15"
                defaultValue="member"
                name="role"
              >
                <option value="member">{t("team.roleMember")}</option>
                <option value="admin">{t("team.roleAdmin")}</option>
                <option value="read-only">{t("team.roleReadOnly")}</option>
              </select>
            </label>
            <Button type="submit">{t("team.sendInvite")}</Button>
          </form>
        </section>
      ) : null}

      {canManage && invitations.length > 0 ? (
        <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
          <h2 className="text-xl font-black">{t("team.pendingInvitations")}</h2>
          <div className="mt-5 grid gap-3">
            {invitations.map((invitation) => (
              <div
                className="flex flex-col justify-between gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center"
                key={invitation.id}
              >
                <div>
                  <p className="font-semibold">{invitation.email}</p>
                  <p className="text-sm capitalize text-muted">
                    {t("team.expiresOn", {
                      role: formatRole(invitation.role),
                      date: new Date(invitation.expires_at).toLocaleDateString()
                    })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <form action={resendInvitationAction}>
                    <input name="organizationId" type="hidden" value={organization.id} />
                    <input name="email" type="hidden" value={invitation.email} />
                    <input name="role" type="hidden" value={invitation.role} />
                    <Button size="sm" type="submit" variant="outline">
                      {t("team.resend")}
                    </Button>
                  </form>
                  <form action={revokeInvitationAction}>
                    <input name="organizationId" type="hidden" value={organization.id} />
                    <input name="invitationId" type="hidden" value={invitation.id} />
                    <Button size="sm" type="submit" variant="outline">
                      {t("team.revoke")}
                    </Button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <h2 className="text-xl font-black">{t("team.members")}</h2>
        <div className="mt-5 grid gap-3">
          {members.map((member) => (
            <div
              className="flex flex-col justify-between gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center"
              key={member.id}
            >
              <div>
                <p className="font-semibold">
                  {member.profile?.name ?? member.profile?.email ?? t("team.unknownMember")}
                </p>
                <p className="text-sm text-muted">{formatRole(member.role)}</p>
              </div>
              {canManage && member.user_id !== context.user.id && member.role !== "owner" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <form action={updateMemberRoleAction} className="flex items-center gap-2">
                    <input name="organizationId" type="hidden" value={organization.id} />
                    <input name="memberId" type="hidden" value={member.id} />
                    <select
                      className="min-h-9 rounded-md border border-border bg-panel px-2 text-sm font-normal outline-none transition focus:border-foreground focus:ring-2 focus:ring-foreground/15"
                      defaultValue={member.role}
                      name="role"
                    >
                      <option value="member">{t("team.roleMember")}</option>
                      <option value="admin">{t("team.roleAdmin")}</option>
                      <option value="read-only">{t("team.roleReadOnly")}</option>
                    </select>
                    <Button size="sm" type="submit" variant="outline">
                      {t("team.updateRole")}
                    </Button>
                  </form>
                  <form action={removeMemberAction}>
                    <input name="organizationId" type="hidden" value={organization.id} />
                    <input name="memberId" type="hidden" value={member.id} />
                    <Button size="sm" type="submit" variant="outline">
                      {t("team.remove")}
                    </Button>
                  </form>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {isOwner && otherMembers.length > 0 ? (
        <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
          <h2 className="text-xl font-black">{t("team.transferOwnership")}</h2>
          <p className="mt-2 leading-7 text-muted">{t("team.transferDescription")}</p>
          <form action={transferOwnershipAction} className="mt-5 flex flex-wrap items-end gap-4">
            <input name="organizationId" type="hidden" value={organization.id} />
            <label className="grid gap-2 text-sm font-semibold">
              <span>{t("team.newOwnerLabel")}</span>
              <select
                className="min-h-11 rounded-md border border-border bg-panel px-3 text-base font-normal outline-none transition focus:border-foreground focus:ring-2 focus:ring-foreground/15"
                name="newOwnerId"
                required
              >
                {otherMembers.map((member) => (
                  <option key={member.id} value={member.user_id}>
                    {member.profile?.name ?? member.profile?.email ?? member.user_id}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="outline">
              {t("team.transferOwnership")}
            </Button>
          </form>
        </section>
      ) : null}

      <section className="rounded-lg border border-red-200 bg-panel p-6 shadow-sm">
        <h2 className="text-xl font-black text-red-800">{t("team.dangerZone")}</h2>
        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">{t("team.leaveOrganization")}</p>
            <p className="text-sm text-muted">
              {isOwner ? t("team.leaveOwnerHint") : t("team.leaveMemberHint")}
            </p>
          </div>
          <form action={leaveOrganizationAction}>
            <input name="organizationId" type="hidden" value={organization.id} />
            <Button type="submit" variant="outline">
              {t("team.leave")}
            </Button>
          </form>
        </div>
        {isOwner ? (
          <div className="mt-5 flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">{t("team.deleteOrganization")}</p>
              <p className="text-sm text-muted">{t("team.deleteDescription")}</p>
            </div>
            <form action={deleteOrganizationAction}>
              <input name="organizationId" type="hidden" value={organization.id} />
              <Button type="submit" variant="outline">
                {t("team.delete")}
              </Button>
            </form>
          </div>
        ) : null}
      </section>
    </div>
  );
}
