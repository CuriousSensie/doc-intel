import Link from "next/link";

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

function EmptyTeamState() {
  return (
    <main className="mx-auto grid min-h-screen max-w-3xl place-items-center px-6 py-10">
      <section className="w-full rounded-lg border border-border bg-panel p-6 text-center shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Settings</p>
        <h1 className="mt-3 text-3xl font-black">Team</h1>
        <p className="mt-3 leading-7 text-muted">You are not part of an organization yet.</p>
        <Button asChild className="mt-6">
          <Link href="/organizations/new">Create organization</Link>
        </Button>
      </section>
    </main>
  );
}

export default async function TeamSettingsPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; message?: string; invite?: string }>;
}) {
  requireFeature("organizations");
  const context = await requireUser("/settings/team");
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

  return (
    <main className="mx-auto grid min-h-screen max-w-3xl gap-5 px-6 py-10">
      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Settings</p>
        <h1 className="mt-3 text-3xl font-black">Team</h1>
        <p className="mt-3 leading-7 text-muted">Manage members and invitations for {organization.name}.</p>
        <div className="mt-6 grid gap-3">
          <FormMessage error={params.error} message={params.message} />
          {inviteLink ? (
            <p className="break-all rounded-md border border-border bg-panel-strong px-3 py-2 text-sm">
              Invite link (send this to the invitee): <span className="font-mono">{inviteLink}</span>
            </p>
          ) : null}
        </div>
      </section>

      {canManage ? (
        <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
          <h2 className="text-xl font-black">Organization settings</h2>
          <form action={updateOrganizationAction} className="mt-5 grid gap-4">
            <input name="organizationId" type="hidden" value={organization.id} />
            <TextField defaultValue={organization.name} label="Organization name" name="name" required />
            <TextField
              defaultValue={organization.logo_url ?? ""}
              hint="Optional. File uploads land with the files module."
              label="Logo URL"
              name="logoUrl"
            />
            <Button className="justify-self-start" type="submit">
              Save changes
            </Button>
          </form>
        </section>
      ) : null}

      {canManage ? (
        <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
          <h2 className="text-xl font-black">Invite a member</h2>
          <form action={inviteMemberAction} className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <input name="organizationId" type="hidden" value={organization.id} />
            <TextField label="Email" name="email" required type="email" />
            <label className="grid gap-2 text-sm font-semibold">
              <span>Role</span>
              <select
                className="min-h-11 rounded-md border border-border bg-panel px-3 text-base font-normal outline-none transition focus:border-foreground focus:ring-2 focus:ring-foreground/15"
                defaultValue="member"
                name="role"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <Button type="submit">Send invite</Button>
          </form>
        </section>
      ) : null}

      {canManage && invitations.length > 0 ? (
        <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
          <h2 className="text-xl font-black">Pending invitations</h2>
          <div className="mt-5 grid gap-3">
            {invitations.map((invitation) => (
              <div
                className="flex flex-col justify-between gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center"
                key={invitation.id}
              >
                <div>
                  <p className="font-semibold">{invitation.email}</p>
                  <p className="text-sm capitalize text-muted">
                    {invitation.role} &middot; expires {new Date(invitation.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <form action={resendInvitationAction}>
                    <input name="organizationId" type="hidden" value={organization.id} />
                    <input name="email" type="hidden" value={invitation.email} />
                    <input name="role" type="hidden" value={invitation.role} />
                    <Button size="sm" type="submit" variant="outline">
                      Resend
                    </Button>
                  </form>
                  <form action={revokeInvitationAction}>
                    <input name="organizationId" type="hidden" value={organization.id} />
                    <input name="invitationId" type="hidden" value={invitation.id} />
                    <Button size="sm" type="submit" variant="outline">
                      Revoke
                    </Button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <h2 className="text-xl font-black">Members</h2>
        <div className="mt-5 grid gap-3">
          {members.map((member) => (
            <div
              className="flex flex-col justify-between gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center"
              key={member.id}
            >
              <div>
                <p className="font-semibold">{member.profile?.name ?? member.profile?.email ?? "Unknown"}</p>
                <p className="text-sm capitalize text-muted">{member.role}</p>
              </div>
              {canManage && member.user_id !== context.user.id && member.role !== "owner" ? (
                <div className="flex flex-wrap gap-2">
                  <form action={updateMemberRoleAction}>
                    <input name="organizationId" type="hidden" value={organization.id} />
                    <input name="memberId" type="hidden" value={member.id} />
                    <input name="role" type="hidden" value={member.role === "admin" ? "member" : "admin"} />
                    <Button size="sm" type="submit" variant="outline">
                      Make {member.role === "admin" ? "member" : "admin"}
                    </Button>
                  </form>
                  <form action={removeMemberAction}>
                    <input name="organizationId" type="hidden" value={organization.id} />
                    <input name="memberId" type="hidden" value={member.id} />
                    <Button size="sm" type="submit" variant="outline">
                      Remove
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
          <h2 className="text-xl font-black">Transfer ownership</h2>
          <p className="mt-2 leading-7 text-muted">
            Transferring ownership makes you an admin and promotes the selected member to owner.
          </p>
          <form action={transferOwnershipAction} className="mt-5 flex flex-wrap items-end gap-4">
            <input name="organizationId" type="hidden" value={organization.id} />
            <label className="grid gap-2 text-sm font-semibold">
              <span>New owner</span>
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
              Transfer ownership
            </Button>
          </form>
        </section>
      ) : null}

      <section className="rounded-lg border border-red-200 bg-panel p-6 shadow-sm">
        <h2 className="text-xl font-black text-red-800">Danger zone</h2>
        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">Leave organization</p>
            <p className="text-sm text-muted">
              {isOwner
                ? "Transfer ownership first if you are the only owner."
                : "You can rejoin only if invited again."}
            </p>
          </div>
          <form action={leaveOrganizationAction}>
            <input name="organizationId" type="hidden" value={organization.id} />
            <Button type="submit" variant="outline">
              Leave
            </Button>
          </form>
        </div>
        {isOwner ? (
          <div className="mt-5 flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Delete organization</p>
              <p className="text-sm text-muted">This permanently removes the organization and its data.</p>
            </div>
            <form action={deleteOrganizationAction}>
              <input name="organizationId" type="hidden" value={organization.id} />
              <Button type="submit" variant="outline">
                Delete organization
              </Button>
            </form>
          </div>
        ) : null}
      </section>
    </main>
  );
}
