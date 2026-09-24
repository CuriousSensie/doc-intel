import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { InviteMemberDialog } from "@/components/organizations/invite-member-dialog";
import { MemberActionsMenu } from "@/components/organizations/member-actions-menu";
import { PendingInvitationsDialog } from "@/components/organizations/pending-invitations-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { orgLogoConfig } from "@/config/org-logo";
import { absoluteUrl } from "@/lib/utils";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { countDocumentsByCreator } from "@/modules/documents/documents.service";
import { getActiveOrganizationId } from "@/modules/organizations/active-organization";
import {
  deleteOrganizationAction,
  leaveOrganizationAction,
  transferOwnershipAction,
  updateOrganizationAction,
  uploadOrgLogoAction
} from "@/modules/organizations/organizations.actions";
import {
  getMembership,
  getOrganization,
  listInvitations,
  listMembers,
  type MemberWithProfile
} from "@/modules/organizations/organizations.service";

export const dynamic = "force-dynamic";

async function EmptyTeamState() {
  const t = await getTranslations("settings");

  return (
    <div className="w-full">
      <section className="w-full rounded-lg border border-border bg-panel p-6 text-center shadow-sm">
        <h1 className="text-3xl font-black">{t("team.title")}</h1>
        <p className="mt-3 leading-7 text-muted">{t("team.notInOrganization")}</p>
        <Button variant='outline' asChild className="mt-6">
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
  const context = await requireUser("/organizations");
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
  const owner = members.find((member) => member.role === "owner");
  const otherMembers = members.filter((member) => member.user_id !== context.user.id);
  const docCountByMember = canManage
    ? await countDocumentsByCreator(activeOrganizationId)
    : new Map<string, number>();
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

  function memberDisplayName(member: MemberWithProfile) {
    return member.profile?.name ?? member.profile?.email ?? t("team.unknownMember");
  }

  return (
    <div className="grid w-full gap-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-3xl font-black">{t("team.title")}</h1>
          <p className="mt-1 text-sm text-muted">
            {t("team.manageDescription", { organization: organization.name })}
          </p>
        </div>
        <Badge variant={isOwner ? "accent" : "muted"}>{formatRole(membership.role)}</Badge>
      </div>

      <FormMessage error={params.error} message={params.message} />
      {inviteLink ? (
        <p className="break-all rounded-md border border-border bg-panel-strong px-3 py-2 text-sm">
          {t("team.inviteLinkLabel")} <span className="font-mono">{inviteLink}</span>
        </p>
      ) : null}

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">{t("team.members")}</TabsTrigger>
          <TabsTrigger value="settings">{t("team.organizationSettings")}</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="grid min-w-0 gap-5">
          {canManage ? (
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <h2 className="text-lg font-bold">{t("team.members")}</h2>
              <div className="flex flex-wrap gap-2">
                <InviteMemberDialog
                  organizationId={organization.id}
                  labels={{
                    trigger: t("team.addMember"),
                    title: t("team.inviteMember"),
                    nameLabel: t("team.nameLabel"),
                    emailLabel: t("team.emailLabel"),
                    roleLabel: t("team.roleLabel"),
                    roleMember: t("team.roleMember"),
                    roleAdmin: t("team.roleAdmin"),
                    roleReadOnly: t("team.roleReadOnly"),
                    submit: t("team.sendInvite")
                  }}
                />
                <PendingInvitationsDialog
                  invitations={invitations.map((invitation) => ({
                    ...invitation,
                    roleLabel: formatRole(invitation.role)
                  }))}
                  organizationId={organization.id}
                  labels={{
                    trigger: t("team.pendingInvitations"),
                    title: t("team.pendingInvitations"),
                    nameLabel: t("team.nameLabel"),
                    emailLabel: t("team.emailLabel"),
                    roleLabel: t("team.roleLabel"),
                    expiresLabel: t("team.expiresLabel"),
                    resend: t("team.resend"),
                    revoke: t("team.revoke")
                  }}
                />
              </div>
            </div>
          ) : null}

          <section className="min-w-0 overflow-x-auto rounded-lg border border-border">
            <Table className="min-w-[64rem]">
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-normal">{t("team.members")}</TableHead>
                  <TableHead className="w-28 whitespace-normal">{t("team.roleLabel")}</TableHead>
                  <TableHead className="w-28 whitespace-normal">{t("team.statusLabel")}</TableHead>
                  {canManage ? (
                    <TableHead className="w-20 whitespace-normal">{t("team.docsLabel")}</TableHead>
                  ) : null}
                  <TableHead className="w-28 whitespace-normal">{t("team.accessLabel")}</TableHead>
                  {canManage ? (
                    <TableHead className="w-24 whitespace-normal">
                      <span className="sr-only">{t("team.viewDocs")}</span>
                    </TableHead>
                  ) : null}
                  <TableHead className="w-14 whitespace-normal">
                    <span className="sr-only">{t("team.actionsLabel")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const isBlocked = Boolean(member.blocked_at);
                  const canActOnMember =
                    canManage && member.user_id !== context.user.id && member.role !== "owner";

                  return (
                    <TableRow key={member.id}>
                      <TableCell className="min-w-0">
                        <p className="font-semibold">{memberDisplayName(member)}</p>
                        <p className="truncate text-xs text-muted">
                          {member.profile?.email ?? member.user_id}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={member.role === "owner" ? "accent" : "muted"}>
                          {formatRole(member.role)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={isBlocked ? "danger" : "muted"}>
                          {isBlocked ? t("team.statusBlocked") : t("team.statusRegistered")}
                        </Badge>
                      </TableCell>
                      {canManage ? (
                        <TableCell className="text-sm text-muted">
                          {docCountByMember.get(member.user_id) ?? 0}
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <Badge variant="muted">{t("team.accessComingSoon")}</Badge>
                      </TableCell>
                      {canManage ? (
                        <TableCell>
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/dashboard/documents?createdBy=${member.user_id}`}>
                              {t("team.viewDocs")}
                            </Link>
                          </Button>
                        </TableCell>
                      ) : null}
                      <TableCell>
                        {canActOnMember ? (
                          <MemberActionsMenu
                            currentRole={member.role}
                            isBlocked={isBlocked}
                            labels={{
                              moreActions: t("team.actionsLabel"),
                              changeRoleTo: t("team.changeRoleTo"),
                              block: t("team.block"),
                              unblock: t("team.unblock"),
                              remove: t("team.remove")
                            }}
                            memberId={member.id}
                            organizationId={organization.id}
                            roleLabels={{
                              admin: t("team.roleAdmin"),
                              member: t("team.roleMember"),
                              "read-only": t("team.roleReadOnly")
                            }}
                          />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </section>
        </TabsContent>

        <TabsContent value="settings" className="grid min-w-0 gap-5">
          {canManage ? (
            <section className="rounded-lg border border-border bg-panel p-5 shadow-sm">
              <h2 className="text-lg font-bold">{t("team.organizationSettings")}</h2>
              <div className="mt-5 flex flex-wrap items-center gap-4">
                {organization.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={t("team.logoAlt")}
                    className="size-16 rounded-md border border-border object-cover"
                    src={organization.logo_url}
                  />
                ) : (
                  <div className="flex size-16 items-center justify-center rounded-md border border-border bg-panel-strong text-xs text-muted">
                    {t("team.noLogo")}
                  </div>
                )}
                <form action={uploadOrgLogoAction} className="grid min-w-0 gap-3">
                  <input name="organizationId" type="hidden" value={organization.id} />
                  <input
                    accept={orgLogoConfig.allowedMimeTypes.join(",")}
                    className="max-w-full text-sm"
                    name="file"
                    required
                    type="file"
                  />
                  <Button className="justify-self-start" size="sm" type="submit" variant="outline">
                    {t("team.uploadLogo")}
                  </Button>
                </form>
              </div>

              <form
                action={updateOrganizationAction}
                className="mt-6 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end"
              >
                <input name="organizationId" type="hidden" value={organization.id} />
                <TextField
                  defaultValue={organization.name}
                  label={t("team.organizationNameLabel")}
                  name="name"
                  required
                />
                <Button className="w-full justify-self-start sm:w-auto" type="submit">
                  {t("team.saveChanges")}
                </Button>
              </form>

              <p className="mt-4 text-sm text-muted">
                {t("team.ownerLabel")}: <span className="font-semibold text-foreground">{owner ? memberDisplayName(owner) : "—"}</span>
              </p>
            </section>
          ) : null}

          {isOwner && otherMembers.length > 0 ? (
            <section className="rounded-lg border border-border bg-panel p-5 shadow-sm">
              <h2 className="text-lg font-bold">{t("team.transferOwnership")}</h2>
              <p className="mt-1 text-sm text-muted">{t("team.transferDescription")}</p>
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
                        {memberDisplayName(member)}
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

          <section className="rounded-lg border border-danger/30 bg-panel p-5 shadow-sm">
            <h2 className="text-lg font-bold text-danger">{t("team.dangerZone")}</h2>
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
