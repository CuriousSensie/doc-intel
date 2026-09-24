"use server";

import { getLocale, getTranslations } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

import { AuthorizationError } from "@/lib/errors";
import { logEvent } from "@/lib/events";
import { logger } from "@/lib/logger";
import { absoluteUrl } from "@/lib/utils";
import { requireFeature } from "@/modules/auth/authorization";
import { firstZodError, formDataToObject, resetPasswordSchema } from "@/modules/auth/auth.schemas";
import { withStatus } from "@/modules/auth/redirects";
import { requireUser } from "@/modules/auth/session";
import type { AuthContext } from "@/modules/auth/session";
import { getActiveOrganizationId } from "@/modules/organizations/active-organization";
import { sendEmail } from "@/modules/email/email.service";
import { createNotification } from "@/modules/notifications/notifications.service";
import { uploadOrganizationLogo } from "@/modules/organizations/org-logo.service";
import {
  blockMemberSchema,
  createOrganizationSchema,
  inviteMemberSchema,
  removeMemberSchema,
  transferOwnershipSchema,
  unblockMemberSchema,
  updateMemberRoleSchema,
  updateOrganizationSchema
} from "@/modules/organizations/organizations.schemas";
import {
  acceptInvitation,
  blockMember,
  createAccountForInvitation,
  createInvitation,
  createOrganization,
  deleteOrganization,
  emailAlreadyHasOrganization,
  getInvitationPreview,
  getMembership,
  getOrganization,
  leaveOrganization,
  listMembers,
  removeMember,
  revokeInvitation,
  transferOwnership,
  unblockMember,
  updateMemberRole,
  updateOrganization,
  type AssignableRole
} from "@/modules/organizations/organizations.service";

type Translator = Awaited<ReturnType<typeof getTranslations>>;

function redirectWithError(path: string, error: unknown, t: Translator, locale: Locale): never {
  const message = error instanceof Error ? error.message : t("actions.somethingWentWrong");
  return redirect({ href: withStatus(path, "error", message), locale });
}

async function requireOrgRole(
  organizationId: string,
  userId: string,
  roles: Array<"owner" | "admin">
) {
  const membership = await getMembership(organizationId, userId);

  if (!membership || !roles.includes(membership.role as "owner" | "admin")) {
    const t = await getTranslations("organizations");
    throw new AuthorizationError(t("actions.noPermission"));
  }

  return membership;
}

async function issueInvitation(
  organizationId: string,
  inviter: { id: string; name: string },
  email: string,
  role: AssignableRole,
  inviteeName: string
) {
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  let target = withStatus("/organizations", "message", t("actions.invitationReady"));

  try {
    const [{ token }, organization] = await Promise.all([
      createInvitation(organizationId, inviter.id, email, role, inviteeName),
      getOrganization(organizationId)
    ]);

    target = withStatus(target, "invite", token);

    await logEvent({
      actorId: inviter.id,
      action: "organization.invitation.sent",
      entityType: "organization_invitation",
      organizationId
    });

    const emailResult = await sendEmail({
      to: email,
      template: "organization-invitation",
      variables: {
        organizationName: organization?.name ?? t("actions.yourOrganizationFallback"),
        inviterName: inviter.name,
        role,
        acceptUrl: absoluteUrl(`/invitations/${token}`)
      }
    });

    target = withStatus(
      target,
      "message",
      emailResult ? t("actions.invitationSent") : t("actions.invitationCreatedEmailFailed")
    );
  } catch (error) {
    redirectWithError("/organizations", error, t, locale);
  }

  return redirect({ href: target, locale });
}

export async function createOrganizationAction(formData: FormData) {
  requireFeature("organizations");
  const context = await requireUser("/organizations/new");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const parsed = createOrganizationSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    return redirect({
      href: withStatus("/organizations/new", "error", firstZodError(parsed.error)),
      locale
    });
  }

  try {
    const organizationId = await createOrganization(
      parsed.data.name,
      parsed.data.slug || undefined
    );
    await logEvent({
      actorId: context.user.id,
      action: "organization.created",
      entityType: "organization",
      entityId: organizationId,
      organizationId
    });
  } catch (error) {
    redirectWithError("/organizations/new", error, t, locale);
  }

  return redirect({
    href: withStatus("/organizations", "message", t("actions.organizationCreated")),
    locale
  });
}

export async function updateOrganizationAction(formData: FormData) {
  const context = await requireUser("/organizations");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const organizationId = formData.get("organizationId");

  if (typeof organizationId !== "string") {
    return redirect({
      href: withStatus("/organizations", "error", t("actions.missingOrganization")),
      locale
    });
  }

  await requireOrgRole(organizationId, context.user.id, ["owner", "admin"]);
  const parsed = updateOrganizationSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    return redirect({
      href: withStatus("/organizations", "error", firstZodError(parsed.error)),
      locale
    });
  }

  try {
    await updateOrganization(organizationId, { name: parsed.data.name });
  } catch (error) {
    redirectWithError("/organizations", error, t, locale);
  }

  return redirect({
    href: withStatus("/organizations", "message", t("actions.organizationUpdated")),
    locale
  });
}

export async function uploadOrgLogoAction(formData: FormData) {
  const context = await requireUser("/organizations");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const organizationId = formData.get("organizationId");
  const file = formData.get("file");

  if (typeof organizationId !== "string") {
    return redirect({
      href: withStatus("/organizations", "error", t("actions.missingOrganization")),
      locale
    });
  }

  await requireOrgRole(organizationId, context.user.id, ["owner", "admin"]);

  if (!(file instanceof File) || file.size === 0) {
    return redirect({
      href: withStatus("/organizations", "error", t("actions.chooseLogoImage")),
      locale
    });
  }

  try {
    await uploadOrganizationLogo(context.user.id, organizationId, {
      buffer: Buffer.from(await file.arrayBuffer()),
      declaredMimeType: file.type || "application/octet-stream",
      size: file.size
    });
  } catch (error) {
    redirectWithError("/organizations", error, t, locale);
  }

  return redirect({
    href: withStatus("/organizations", "message", t("actions.organizationUpdated")),
    locale
  });
}

export async function inviteMemberAction(formData: FormData) {
  requireFeature("organizations");
  const context = await requireUser("/organizations");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const organizationId = formData.get("organizationId");

  if (typeof organizationId !== "string") {
    return redirect({
      href: withStatus("/organizations", "error", t("actions.missingOrganization")),
      locale
    });
  }

  await requireOrgRole(organizationId, context.user.id, ["owner", "admin"]);
  const parsed = inviteMemberSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    return redirect({
      href: withStatus("/organizations", "error", firstZodError(parsed.error)),
      locale
    });
  }

  if (await emailAlreadyHasOrganization(parsed.data.email)) {
    return redirect({
      href: withStatus("/organizations", "error", t("actions.emailAlreadyInOrganization")),
      locale
    });
  }

  await issueInvitation(
    organizationId,
    {
      id: context.user.id,
      name: context.profile?.name ?? context.user.email ?? t("actions.teamMemberFallback")
    },
    parsed.data.email,
    parsed.data.role,
    parsed.data.name
  );
}

export async function resendInvitationAction(formData: FormData) {
  requireFeature("organizations");
  const context = await requireUser("/organizations");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const organizationId = formData.get("organizationId");
  const email = formData.get("email");
  const role = formData.get("role");
  const name = formData.get("name");

  if (
    typeof organizationId !== "string" ||
    typeof email !== "string" ||
    typeof name !== "string" ||
    (role !== "admin" && role !== "member" && role !== "read-only")
  ) {
    return redirect({
      href: withStatus("/organizations", "error", t("actions.missingInvitationDetails")),
      locale
    });
  }

  await requireOrgRole(organizationId, context.user.id, ["owner", "admin"]);
  await issueInvitation(
    organizationId,
    {
      id: context.user.id,
      name: context.profile?.name ?? context.user.email ?? t("actions.teamMemberFallback")
    },
    email,
    role,
    name
  );
}

export async function revokeInvitationAction(formData: FormData) {
  const context = await requireUser("/organizations");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const organizationId = formData.get("organizationId");
  const invitationId = formData.get("invitationId");

  if (typeof organizationId !== "string" || typeof invitationId !== "string") {
    return redirect({
      href: withStatus("/organizations", "error", t("actions.missingInvitation")),
      locale
    });
  }

  await requireOrgRole(organizationId, context.user.id, ["owner", "admin"]);

  try {
    await revokeInvitation(invitationId);
  } catch (error) {
    redirectWithError("/organizations", error, t, locale);
  }

  return redirect({
    href: withStatus("/organizations", "message", t("actions.invitationRevoked")),
    locale
  });
}

export async function updateMemberRoleAction(formData: FormData) {
  const context = await requireUser("/organizations");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const organizationId = formData.get("organizationId");
  const parsed = updateMemberRoleSchema.safeParse(formDataToObject(formData));

  if (typeof organizationId !== "string" || !parsed.success) {
    return redirect({
      href: withStatus("/organizations", "error", t("actions.invalidRoleUpdate")),
      locale
    });
  }

  await requireOrgRole(organizationId, context.user.id, ["owner", "admin"]);

  try {
    // ADR-0008: update_member_role() writes the audit row atomically — no separate logEvent().
    await updateMemberRole(parsed.data.memberId, parsed.data.role);
  } catch (error) {
    redirectWithError("/organizations", error, t, locale);
  }

  return redirect({
    href: withStatus("/organizations", "message", t("actions.memberRoleUpdated")),
    locale
  });
}

export async function removeMemberAction(formData: FormData) {
  const context = await requireUser("/organizations");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const organizationId = formData.get("organizationId");
  const parsed = removeMemberSchema.safeParse(formDataToObject(formData));

  if (typeof organizationId !== "string" || !parsed.success) {
    return redirect({
      href: withStatus("/organizations", "error", t("actions.missingMember")),
      locale
    });
  }

  await requireOrgRole(organizationId, context.user.id, ["owner", "admin"]);

  try {
    // ADR-0008: remove_member() writes the audit row atomically — no separate logEvent().
    await removeMember(parsed.data.memberId);
  } catch (error) {
    redirectWithError("/organizations", error, t, locale);
  }

  return redirect({
    href: withStatus("/organizations", "message", t("actions.memberRemoved")),
    locale
  });
}

export async function leaveOrganizationAction(formData: FormData) {
  await requireUser("/organizations");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const organizationId = formData.get("organizationId");

  if (typeof organizationId !== "string") {
    return redirect({
      href: withStatus("/organizations", "error", t("actions.missingOrganization")),
      locale
    });
  }

  try {
    // ADR-0008: leave_organization() writes the audit row atomically — no separate logEvent().
    await leaveOrganization(organizationId);
  } catch (error) {
    redirectWithError("/organizations", error, t, locale);
  }

  return redirect({
    href: withStatus("/organizations", "message", t("actions.youLeftOrganization")),
    locale
  });
}

export async function blockMemberAction(formData: FormData) {
  const context = await requireUser("/organizations");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const organizationId = formData.get("organizationId");
  const parsed = blockMemberSchema.safeParse(formDataToObject(formData));

  if (typeof organizationId !== "string" || !parsed.success) {
    return redirect({
      href: withStatus("/organizations", "error", t("actions.missingMember")),
      locale
    });
  }

  await requireOrgRole(organizationId, context.user.id, ["owner", "admin"]);

  try {
    // block_member() writes the audit row atomically, same ADR-0008 shape as removeMember().
    await blockMember(parsed.data.memberId);
  } catch (error) {
    redirectWithError("/organizations", error, t, locale);
  }

  return redirect({
    href: withStatus("/organizations", "message", t("actions.memberBlocked")),
    locale
  });
}

export async function unblockMemberAction(formData: FormData) {
  const context = await requireUser("/organizations");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const organizationId = formData.get("organizationId");
  const parsed = unblockMemberSchema.safeParse(formDataToObject(formData));

  if (typeof organizationId !== "string" || !parsed.success) {
    return redirect({
      href: withStatus("/organizations", "error", t("actions.missingMember")),
      locale
    });
  }

  await requireOrgRole(organizationId, context.user.id, ["owner", "admin"]);

  try {
    await unblockMember(parsed.data.memberId);
  } catch (error) {
    redirectWithError("/organizations", error, t, locale);
  }

  return redirect({
    href: withStatus("/organizations", "message", t("actions.memberUnblocked")),
    locale
  });
}

export async function transferOwnershipAction(formData: FormData) {
  const context = await requireUser("/organizations");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const organizationId = formData.get("organizationId");
  const parsed = transferOwnershipSchema.safeParse(formDataToObject(formData));

  if (typeof organizationId !== "string" || !parsed.success) {
    return redirect({
      href: withStatus("/organizations", "error", t("actions.invalidTransferRequest")),
      locale
    });
  }

  await requireOrgRole(organizationId, context.user.id, ["owner"]);

  try {
    // ADR-0008: transfer_organization_ownership() writes the audit row atomically — no
    // separate logEvent().
    await transferOwnership(organizationId, parsed.data.newOwnerId);
  } catch (error) {
    redirectWithError("/organizations", error, t, locale);
  }

  return redirect({
    href: withStatus("/organizations", "message", t("actions.ownershipTransferred")),
    locale
  });
}

export async function deleteOrganizationAction(formData: FormData) {
  const context = await requireUser("/organizations");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const organizationId = formData.get("organizationId");

  if (typeof organizationId !== "string") {
    return redirect({
      href: withStatus("/organizations", "error", t("actions.missingOrganization")),
      locale
    });
  }

  await requireOrgRole(organizationId, context.user.id, ["owner"]);

  try {
    await logEvent({
      actorId: context.user.id,
      action: "organization.deleted",
      entityType: "organization",
      entityId: organizationId,
      organizationId
    });
    await deleteOrganization(organizationId);
  } catch (error) {
    redirectWithError("/organizations", error, t, locale);
  }

  return redirect({
    href: withStatus("/organizations", "message", t("actions.organizationDeleted")),
    locale
  });
}

async function notifyOrganizationAdminsOfNewMember(organizationId: string, newMember: AuthContext) {
  const t = await getTranslations("organizations");
  try {
    const [organization, members] = await Promise.all([
      getOrganization(organizationId),
      listMembers(organizationId)
    ]);
    const recipients = members.filter(
      (member) =>
        (member.role === "owner" || member.role === "admin") && member.user_id !== newMember.user.id
    );
    const joinedName =
      newMember.profile?.name ?? newMember.user.email ?? t("actions.someoneFallback");

    await Promise.all(
      recipients.map((member) =>
        createNotification(member.user_id, {
          type: "organization.member_joined",
          title: t("actions.newMemberNotificationTitle"),
          message: t("actions.newMemberNotificationMessage", {
            name: joinedName,
            organization: organization?.name ?? t("actions.yourOrganizationFallback")
          }),
          metadata: { organizationId, newMemberId: newMember.user.id }
        })
      )
    );
  } catch (error) {
    logger.error("organizations.notify_admins_failed", {
      organizationId,
      errorMessage: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

// Invited employees never touch /register or Supabase email verification (see plan:
// organizations/team revamp) — name and email come from the invitation record itself, not
// client input, so the signup form only actually collects a password.
export async function acceptInvitationSignupAction(formData: FormData) {
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const token = formData.get("token");

  if (typeof token !== "string") {
    return redirect({
      href: withStatus("/dashboard", "error", t("actions.missingInvitationToken")),
      locale
    });
  }

  const invitePath = `/invitations/${token}`;
  const invitation = await getInvitationPreview(token);

  if (
    !invitation ||
    invitation.revoked_at ||
    invitation.accepted_at ||
    new Date(invitation.expires_at) <= new Date()
  ) {
    return redirect({ href: withStatus(invitePath, "error", t("actions.invitationNoLongerValid")), locale });
  }

  const parsed = resetPasswordSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    return redirect({ href: withStatus(invitePath, "error", firstZodError(parsed.error)), locale });
  }

  let organizationId: string;

  try {
    await createAccountForInvitation({
      email: invitation.email,
      name: invitation.invitee_name ?? invitation.email,
      password: parsed.data.password
    });
    organizationId = await acceptInvitation(token);
  } catch (error) {
    redirectWithError(invitePath, error, t, locale);
  }

  const context = await requireUser(invitePath);
  await logEvent({
    actorId: context.user.id,
    action: "organization.invitation.accepted",
    entityType: "organization",
    entityId: organizationId,
    organizationId
  });
  await notifyOrganizationAdminsOfNewMember(organizationId, context);

  return redirect({
    href: withStatus("/dashboard", "message", t("actions.invitationAccepted")),
    locale
  });
}

export async function acceptInvitationAction(formData: FormData) {
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const token = formData.get("token");

  if (typeof token !== "string") {
    return redirect({
      href: withStatus("/dashboard", "error", t("actions.missingInvitationToken")),
      locale
    });
  }

  const context = await requireUser(`/invitations/${token}`);
  let organizationId: string;

  try {
    organizationId = await acceptInvitation(token);
    await logEvent({
      actorId: context.user.id,
      action: "organization.invitation.accepted",
      entityType: "organization",
      entityId: organizationId,
      organizationId
    });
  } catch (error) {
    redirectWithError(`/invitations/${token}`, error, t, locale);
  }

  await notifyOrganizationAdminsOfNewMember(organizationId, context);
  return redirect({
    href: withStatus("/dashboard", "message", t("actions.invitationAccepted")),
    locale
  });
}

// Thin member listing for pickers outside the team-management page (e.g. folder-access-manager,
// ADR-0019) — every member is a valid grant target, no role/isReadOnly filtering needed here.
export async function listOrganizationMembersAction(): Promise<
  Array<{ userId: string; name: string | null; email: string }>
> {
  const context = await requireUser("/dashboard");
  const organizationId = await getActiveOrganizationId(context.user.id);
  if (!organizationId) return [];
  const members = await listMembers(organizationId);
  return members.map((member) => ({
    userId: member.user_id,
    name: member.profile?.name ?? null,
    email: member.profile?.email ?? ""
  }));
}
