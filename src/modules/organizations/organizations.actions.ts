"use server";

import { redirect } from "next/navigation";

import { AuthorizationError } from "@/lib/errors";
import { absoluteUrl } from "@/lib/utils";
import { requireFeature } from "@/modules/auth/authorization";
import { firstZodError, formDataToObject } from "@/modules/auth/auth.schemas";
import { getSafeRedirectPath, withStatus } from "@/modules/auth/redirects";
import { requireUser } from "@/modules/auth/session";
import { sendEmail } from "@/modules/email/email.service";
import { clearActiveOrganization, setActiveOrganization } from "@/modules/organizations/active-organization";
import {
  createOrganizationSchema,
  inviteMemberSchema,
  removeMemberSchema,
  transferOwnershipSchema,
  updateMemberRoleSchema,
  updateOrganizationSchema
} from "@/modules/organizations/organizations.schemas";
import {
  acceptInvitation,
  createInvitation,
  createOrganization,
  deleteOrganization,
  getMembership,
  getOrganization,
  leaveOrganization,
  removeMember,
  revokeInvitation,
  transferOwnership,
  updateMemberRole,
  updateOrganization,
  type AssignableRole
} from "@/modules/organizations/organizations.service";

function redirectWithError(path: string, error: unknown): never {
  const message = error instanceof Error ? error.message : "Something went wrong";
  redirect(withStatus(path, "error", message));
}

async function requireOrgRole(organizationId: string, userId: string, roles: Array<"owner" | "admin">) {
  const membership = await getMembership(organizationId, userId);

  if (!membership || !roles.includes(membership.role as "owner" | "admin")) {
    throw new AuthorizationError("You do not have permission to manage this organization");
  }

  return membership;
}

async function issueInvitation(
  organizationId: string,
  inviter: { id: string; name: string },
  email: string,
  role: AssignableRole
) {
  let target = withStatus("/settings/team", "message", "Invitation ready. Share the link below.");

  try {
    const [{ token }, organization] = await Promise.all([
      createInvitation(organizationId, inviter.id, email, role),
      getOrganization(organizationId)
    ]);

    target = withStatus(target, "invite", token);

    const emailResult = await sendEmail({
      to: email,
      template: "organization-invitation",
      variables: {
        organizationName: organization?.name ?? "your organization",
        inviterName: inviter.name,
        role,
        acceptUrl: absoluteUrl(`/invitations/${token}`)
      }
    });

    target = withStatus(
      target,
      "message",
      emailResult
        ? "Invitation sent."
        : "Invitation created, but the email could not be sent. Share the link below."
    );
  } catch (error) {
    redirectWithError("/settings/team", error);
  }

  redirect(target);
}

export async function createOrganizationAction(formData: FormData) {
  requireFeature("organizations");
  await requireUser("/organizations/new");
  const parsed = createOrganizationSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    redirect(withStatus("/organizations/new", "error", firstZodError(parsed.error)));
  }

  try {
    const organizationId = await createOrganization(parsed.data.name, parsed.data.slug || undefined);
    await setActiveOrganization(organizationId);
  } catch (error) {
    redirectWithError("/organizations/new", error);
  }

  redirect(withStatus("/settings/team", "message", "Organization created."));
}

export async function updateOrganizationAction(formData: FormData) {
  const context = await requireUser("/settings/team");
  const organizationId = formData.get("organizationId");

  if (typeof organizationId !== "string") {
    redirect(withStatus("/settings/team", "error", "Missing organization"));
  }

  await requireOrgRole(organizationId, context.user.id, ["owner", "admin"]);
  const parsed = updateOrganizationSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    redirect(withStatus("/settings/team", "error", firstZodError(parsed.error)));
  }

  try {
    await updateOrganization(organizationId, {
      name: parsed.data.name,
      logo_url: parsed.data.logoUrl || null
    });
  } catch (error) {
    redirectWithError("/settings/team", error);
  }

  redirect(withStatus("/settings/team", "message", "Organization updated."));
}

export async function inviteMemberAction(formData: FormData) {
  requireFeature("organizations");
  const context = await requireUser("/settings/team");
  const organizationId = formData.get("organizationId");

  if (typeof organizationId !== "string") {
    redirect(withStatus("/settings/team", "error", "Missing organization"));
  }

  await requireOrgRole(organizationId, context.user.id, ["owner", "admin"]);
  const parsed = inviteMemberSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    redirect(withStatus("/settings/team", "error", firstZodError(parsed.error)));
  }

  await issueInvitation(
    organizationId,
    { id: context.user.id, name: context.profile?.name ?? context.user.email ?? "A team member" },
    parsed.data.email,
    parsed.data.role
  );
}

export async function resendInvitationAction(formData: FormData) {
  requireFeature("organizations");
  const context = await requireUser("/settings/team");
  const organizationId = formData.get("organizationId");
  const email = formData.get("email");
  const role = formData.get("role");

  if (
    typeof organizationId !== "string" ||
    typeof email !== "string" ||
    (role !== "admin" && role !== "member")
  ) {
    redirect(withStatus("/settings/team", "error", "Missing invitation details"));
  }

  await requireOrgRole(organizationId, context.user.id, ["owner", "admin"]);
  await issueInvitation(
    organizationId,
    { id: context.user.id, name: context.profile?.name ?? context.user.email ?? "A team member" },
    email,
    role
  );
}

export async function revokeInvitationAction(formData: FormData) {
  const context = await requireUser("/settings/team");
  const organizationId = formData.get("organizationId");
  const invitationId = formData.get("invitationId");

  if (typeof organizationId !== "string" || typeof invitationId !== "string") {
    redirect(withStatus("/settings/team", "error", "Missing invitation"));
  }

  await requireOrgRole(organizationId, context.user.id, ["owner", "admin"]);

  try {
    await revokeInvitation(invitationId);
  } catch (error) {
    redirectWithError("/settings/team", error);
  }

  redirect(withStatus("/settings/team", "message", "Invitation revoked."));
}

export async function updateMemberRoleAction(formData: FormData) {
  const context = await requireUser("/settings/team");
  const organizationId = formData.get("organizationId");
  const parsed = updateMemberRoleSchema.safeParse(formDataToObject(formData));

  if (typeof organizationId !== "string" || !parsed.success) {
    redirect(withStatus("/settings/team", "error", "Invalid role update"));
  }

  await requireOrgRole(organizationId, context.user.id, ["owner", "admin"]);

  try {
    await updateMemberRole(parsed.data.memberId, parsed.data.role);
  } catch (error) {
    redirectWithError("/settings/team", error);
  }

  redirect(withStatus("/settings/team", "message", "Member role updated."));
}

export async function removeMemberAction(formData: FormData) {
  const context = await requireUser("/settings/team");
  const organizationId = formData.get("organizationId");
  const parsed = removeMemberSchema.safeParse(formDataToObject(formData));

  if (typeof organizationId !== "string" || !parsed.success) {
    redirect(withStatus("/settings/team", "error", "Missing member"));
  }

  await requireOrgRole(organizationId, context.user.id, ["owner", "admin"]);

  try {
    await removeMember(parsed.data.memberId);
  } catch (error) {
    redirectWithError("/settings/team", error);
  }

  redirect(withStatus("/settings/team", "message", "Member removed."));
}

export async function leaveOrganizationAction(formData: FormData) {
  const context = await requireUser("/organizations");
  const organizationId = formData.get("organizationId");

  if (typeof organizationId !== "string") {
    redirect(withStatus("/organizations", "error", "Missing organization"));
  }

  try {
    await leaveOrganization(organizationId, context.user.id);
  } catch (error) {
    redirectWithError("/settings/team", error);
  }

  await clearActiveOrganization();
  redirect(withStatus("/organizations", "message", "You left the organization."));
}

export async function transferOwnershipAction(formData: FormData) {
  const context = await requireUser("/settings/team");
  const organizationId = formData.get("organizationId");
  const parsed = transferOwnershipSchema.safeParse(formDataToObject(formData));

  if (typeof organizationId !== "string" || !parsed.success) {
    redirect(withStatus("/settings/team", "error", "Invalid transfer request"));
  }

  await requireOrgRole(organizationId, context.user.id, ["owner"]);

  try {
    await transferOwnership(organizationId, parsed.data.newOwnerId);
  } catch (error) {
    redirectWithError("/settings/team", error);
  }

  redirect(withStatus("/settings/team", "message", "Ownership transferred."));
}

export async function deleteOrganizationAction(formData: FormData) {
  const context = await requireUser("/settings/team");
  const organizationId = formData.get("organizationId");

  if (typeof organizationId !== "string") {
    redirect(withStatus("/settings/team", "error", "Missing organization"));
  }

  await requireOrgRole(organizationId, context.user.id, ["owner"]);

  try {
    await deleteOrganization(organizationId);
  } catch (error) {
    redirectWithError("/settings/team", error);
  }

  await clearActiveOrganization();
  redirect(withStatus("/organizations", "message", "Organization deleted."));
}

export async function switchOrganizationAction(formData: FormData) {
  const context = await requireUser("/organizations");
  const organizationId = formData.get("organizationId");
  const next = getSafeRedirectPath(formData.get("next"));

  if (typeof organizationId !== "string") {
    redirect(withStatus("/organizations", "error", "Missing organization"));
  }

  const membership = await getMembership(organizationId, context.user.id);

  if (!membership) {
    redirect(withStatus("/organizations", "error", "You are not a member of that organization"));
  }

  await setActiveOrganization(organizationId);
  redirect(next);
}

export async function acceptInvitationAction(formData: FormData) {
  const token = formData.get("token");

  if (typeof token !== "string") {
    redirect(withStatus("/dashboard", "error", "Missing invitation token"));
  }

  await requireUser(`/invitations/${token}`);

  try {
    const organizationId = await acceptInvitation(token);
    await setActiveOrganization(organizationId);
  } catch (error) {
    redirectWithError(`/invitations/${token}`, error);
  }

  redirect(withStatus("/dashboard", "message", "Invitation accepted."));
}
