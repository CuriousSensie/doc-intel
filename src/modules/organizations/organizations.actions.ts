"use server";

import { getLocale, getTranslations } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

import { AuthorizationError } from "@/lib/errors";
import { logEvent } from "@/lib/events";
import { logger } from "@/lib/logger";
import { absoluteUrl } from "@/lib/utils";
import { requireFeature } from "@/modules/auth/authorization";
import { firstZodError, formDataToObject } from "@/modules/auth/auth.schemas";
import { getSafeRedirectPath, withStatus } from "@/modules/auth/redirects";
import { requireUser } from "@/modules/auth/session";
import type { AuthContext } from "@/modules/auth/session";
import { sendEmail } from "@/modules/email/email.service";
import { createNotification } from "@/modules/notifications/notifications.service";
import {
  clearActiveOrganization,
  setActiveOrganization
} from "@/modules/organizations/active-organization";
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
  listMembers,
  removeMember,
  revokeInvitation,
  transferOwnership,
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
  role: AssignableRole
) {
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  let target = withStatus("/settings/team", "message", t("actions.invitationReady"));

  try {
    const [{ token }, organization] = await Promise.all([
      createInvitation(organizationId, inviter.id, email, role),
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
    redirectWithError("/settings/team", error, t, locale);
  }

  return redirect({ href: target, locale });
}

export async function createOrganizationAction(formData: FormData) {
  requireFeature("organizations");
  const context = await requireUser("/organizations/new");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const parsed = createOrganizationSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    return redirect({ href: withStatus("/organizations/new", "error", firstZodError(parsed.error)), locale });
  }

  try {
    const organizationId = await createOrganization(
      parsed.data.name,
      parsed.data.slug || undefined
    );
    await setActiveOrganization(organizationId);
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

  return redirect({ href: withStatus("/settings/team", "message", t("actions.organizationCreated")), locale });
}

export async function updateOrganizationAction(formData: FormData) {
  const context = await requireUser("/settings/team");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const organizationId = formData.get("organizationId");

  if (typeof organizationId !== "string") {
    return redirect({ href: withStatus("/settings/team", "error", t("actions.missingOrganization")), locale });
  }

  await requireOrgRole(organizationId, context.user.id, ["owner", "admin"]);
  const parsed = updateOrganizationSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    return redirect({ href: withStatus("/settings/team", "error", firstZodError(parsed.error)), locale });
  }

  try {
    await updateOrganization(organizationId, {
      name: parsed.data.name,
      logo_url: parsed.data.logoUrl || null
    });
  } catch (error) {
    redirectWithError("/settings/team", error, t, locale);
  }

  return redirect({ href: withStatus("/settings/team", "message", t("actions.organizationUpdated")), locale });
}

export async function inviteMemberAction(formData: FormData) {
  requireFeature("organizations");
  const context = await requireUser("/settings/team");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const organizationId = formData.get("organizationId");

  if (typeof organizationId !== "string") {
    return redirect({ href: withStatus("/settings/team", "error", t("actions.missingOrganization")), locale });
  }

  await requireOrgRole(organizationId, context.user.id, ["owner", "admin"]);
  const parsed = inviteMemberSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    return redirect({ href: withStatus("/settings/team", "error", firstZodError(parsed.error)), locale });
  }

  await issueInvitation(
    organizationId,
    { id: context.user.id, name: context.profile?.name ?? context.user.email ?? t("actions.teamMemberFallback") },
    parsed.data.email,
    parsed.data.role
  );
}

export async function resendInvitationAction(formData: FormData) {
  requireFeature("organizations");
  const context = await requireUser("/settings/team");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const organizationId = formData.get("organizationId");
  const email = formData.get("email");
  const role = formData.get("role");

  if (
    typeof organizationId !== "string" ||
    typeof email !== "string" ||
    (role !== "admin" && role !== "member")
  ) {
    return redirect({
      href: withStatus("/settings/team", "error", t("actions.missingInvitationDetails")),
      locale
    });
  }

  await requireOrgRole(organizationId, context.user.id, ["owner", "admin"]);
  await issueInvitation(
    organizationId,
    { id: context.user.id, name: context.profile?.name ?? context.user.email ?? t("actions.teamMemberFallback") },
    email,
    role
  );
}

export async function revokeInvitationAction(formData: FormData) {
  const context = await requireUser("/settings/team");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const organizationId = formData.get("organizationId");
  const invitationId = formData.get("invitationId");

  if (typeof organizationId !== "string" || typeof invitationId !== "string") {
    return redirect({ href: withStatus("/settings/team", "error", t("actions.missingInvitation")), locale });
  }

  await requireOrgRole(organizationId, context.user.id, ["owner", "admin"]);

  try {
    await revokeInvitation(invitationId);
  } catch (error) {
    redirectWithError("/settings/team", error, t, locale);
  }

  return redirect({ href: withStatus("/settings/team", "message", t("actions.invitationRevoked")), locale });
}

export async function updateMemberRoleAction(formData: FormData) {
  const context = await requireUser("/settings/team");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const organizationId = formData.get("organizationId");
  const parsed = updateMemberRoleSchema.safeParse(formDataToObject(formData));

  if (typeof organizationId !== "string" || !parsed.success) {
    return redirect({ href: withStatus("/settings/team", "error", t("actions.invalidRoleUpdate")), locale });
  }

  await requireOrgRole(organizationId, context.user.id, ["owner", "admin"]);

  try {
    // ADR-0008: update_member_role() writes the audit row atomically — no separate logEvent().
    await updateMemberRole(parsed.data.memberId, parsed.data.role);
  } catch (error) {
    redirectWithError("/settings/team", error, t, locale);
  }

  return redirect({ href: withStatus("/settings/team", "message", t("actions.memberRoleUpdated")), locale });
}

export async function removeMemberAction(formData: FormData) {
  const context = await requireUser("/settings/team");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const organizationId = formData.get("organizationId");
  const parsed = removeMemberSchema.safeParse(formDataToObject(formData));

  if (typeof organizationId !== "string" || !parsed.success) {
    return redirect({ href: withStatus("/settings/team", "error", t("actions.missingMember")), locale });
  }

  await requireOrgRole(organizationId, context.user.id, ["owner", "admin"]);

  try {
    // ADR-0008: remove_member() writes the audit row atomically — no separate logEvent().
    await removeMember(parsed.data.memberId);
  } catch (error) {
    redirectWithError("/settings/team", error, t, locale);
  }

  return redirect({ href: withStatus("/settings/team", "message", t("actions.memberRemoved")), locale });
}

export async function leaveOrganizationAction(formData: FormData) {
  await requireUser("/organizations");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const organizationId = formData.get("organizationId");

  if (typeof organizationId !== "string") {
    return redirect({ href: withStatus("/organizations", "error", t("actions.missingOrganization")), locale });
  }

  try {
    // ADR-0008: leave_organization() writes the audit row atomically — no separate logEvent().
    await leaveOrganization(organizationId);
  } catch (error) {
    redirectWithError("/settings/team", error, t, locale);
  }

  await clearActiveOrganization();
  return redirect({ href: withStatus("/organizations", "message", t("actions.youLeftOrganization")), locale });
}

export async function transferOwnershipAction(formData: FormData) {
  const context = await requireUser("/settings/team");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const organizationId = formData.get("organizationId");
  const parsed = transferOwnershipSchema.safeParse(formDataToObject(formData));

  if (typeof organizationId !== "string" || !parsed.success) {
    return redirect({
      href: withStatus("/settings/team", "error", t("actions.invalidTransferRequest")),
      locale
    });
  }

  await requireOrgRole(organizationId, context.user.id, ["owner"]);

  try {
    // ADR-0008: transfer_organization_ownership() writes the audit row atomically — no
    // separate logEvent().
    await transferOwnership(organizationId, parsed.data.newOwnerId);
  } catch (error) {
    redirectWithError("/settings/team", error, t, locale);
  }

  return redirect({ href: withStatus("/settings/team", "message", t("actions.ownershipTransferred")), locale });
}

export async function deleteOrganizationAction(formData: FormData) {
  const context = await requireUser("/settings/team");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const organizationId = formData.get("organizationId");

  if (typeof organizationId !== "string") {
    return redirect({ href: withStatus("/settings/team", "error", t("actions.missingOrganization")), locale });
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
    redirectWithError("/settings/team", error, t, locale);
  }

  await clearActiveOrganization();
  return redirect({ href: withStatus("/organizations", "message", t("actions.organizationDeleted")), locale });
}

export async function switchOrganizationAction(formData: FormData) {
  const context = await requireUser("/organizations");
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const organizationId = formData.get("organizationId");
  const next = getSafeRedirectPath(formData.get("next"));

  if (typeof organizationId !== "string") {
    return redirect({ href: withStatus("/organizations", "error", t("actions.missingOrganization")), locale });
  }

  const membership = await getMembership(organizationId, context.user.id);

  if (!membership) {
    return redirect({ href: withStatus("/organizations", "error", t("actions.notAMember")), locale });
  }

  await setActiveOrganization(organizationId);
  return redirect({ href: next, locale });
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
    const joinedName = newMember.profile?.name ?? newMember.user.email ?? t("actions.someoneFallback");

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

export async function acceptInvitationAction(formData: FormData) {
  const [t, locale] = await Promise.all([getTranslations("organizations"), getLocale()]);
  const token = formData.get("token");

  if (typeof token !== "string") {
    return redirect({ href: withStatus("/dashboard", "error", t("actions.missingInvitationToken")), locale });
  }

  const context = await requireUser(`/invitations/${token}`);
  let organizationId: string;

  try {
    organizationId = await acceptInvitation(token);
    await setActiveOrganization(organizationId);
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
  return redirect({ href: withStatus("/dashboard", "message", t("actions.invitationAccepted")), locale });
}
