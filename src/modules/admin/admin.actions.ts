"use server";

import { redirect } from "next/navigation";

import { billingOwnerType } from "@/config/billing";
import type { BillingOwner } from "@/modules/billing/owner";
import { adminAdjustCredits } from "@/modules/billing/credits.service";
import { requireFeature } from "@/modules/auth/authorization";
import { withStatus } from "@/modules/auth/redirects";
import { requireAdmin } from "@/modules/auth/session";
import { setSubscriptionPlatformStatus } from "@/modules/admin/billing.service";
import {
  deleteOrganizationAdmin,
  suspendOrganization,
  unsuspendOrganization
} from "@/modules/admin/organizations.service";
import { deleteUserAdmin, setAppAdmin, suspendUser, unsuspendUser } from "@/modules/admin/users.service";

function redirectWithError(path: string, error: unknown): never {
  const message = error instanceof Error ? error.message : "Something went wrong";
  redirect(withStatus(path, "error", message));
}

function requiredString(formData: FormData, key: string): string {
  const value = formData.get(key);

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing ${key}`);
  }

  return value;
}

export async function suspendUserAction(formData: FormData) {
  requireFeature("admin");
  const context = await requireAdmin();

  try {
    await suspendUser(context.user.id, requiredString(formData, "userId"));
  } catch (error) {
    redirectWithError("/admin/users", error);
  }

  redirect(withStatus("/admin/users", "message", "User suspended."));
}

export async function unsuspendUserAction(formData: FormData) {
  requireFeature("admin");
  const context = await requireAdmin();

  try {
    await unsuspendUser(context.user.id, requiredString(formData, "userId"));
  } catch (error) {
    redirectWithError("/admin/users", error);
  }

  redirect(withStatus("/admin/users", "message", "User unsuspended."));
}

export async function setAppAdminAction(formData: FormData) {
  requireFeature("admin");
  const context = await requireAdmin();
  const isAdmin = formData.get("isAdmin") === "true";

  try {
    await setAppAdmin(context.user.id, requiredString(formData, "userId"), isAdmin);
  } catch (error) {
    redirectWithError("/admin/users", error);
  }

  redirect(withStatus("/admin/users", "message", isAdmin ? "Admin access granted." : "Admin access revoked."));
}

export async function deleteUserAdminAction(formData: FormData) {
  requireFeature("admin");
  const context = await requireAdmin();

  try {
    await deleteUserAdmin(context.user.id, requiredString(formData, "userId"));
  } catch (error) {
    redirectWithError("/admin/users", error);
  }

  redirect(withStatus("/admin/users", "message", "User deleted."));
}

export async function suspendOrganizationAction(formData: FormData) {
  requireFeature("admin");
  const context = await requireAdmin();

  try {
    await suspendOrganization(context.user.id, requiredString(formData, "organizationId"));
  } catch (error) {
    redirectWithError("/admin/organizations", error);
  }

  redirect(withStatus("/admin/organizations", "message", "Organization suspended."));
}

export async function unsuspendOrganizationAction(formData: FormData) {
  requireFeature("admin");
  const context = await requireAdmin();

  try {
    await unsuspendOrganization(context.user.id, requiredString(formData, "organizationId"));
  } catch (error) {
    redirectWithError("/admin/organizations", error);
  }

  redirect(withStatus("/admin/organizations", "message", "Organization unsuspended."));
}

export async function deleteOrganizationAdminAction(formData: FormData) {
  requireFeature("admin");
  const context = await requireAdmin();

  try {
    await deleteOrganizationAdmin(context.user.id, requiredString(formData, "organizationId"));
  } catch (error) {
    redirectWithError("/admin/organizations", error);
  }

  redirect(withStatus("/admin/organizations", "message", "Organization deleted."));
}

function billingOwnerFromFormData(formData: FormData): BillingOwner {
  const key = billingOwnerType === "organization" ? "organizationId" : "userId";
  return { type: billingOwnerType, id: requiredString(formData, key) };
}

export async function adjustCreditsAction(formData: FormData) {
  requireFeature("admin");
  const context = await requireAdmin();
  const redirectPath = billingOwnerType === "organization" ? "/admin/organizations" : "/admin/users";
  const amount = Number(formData.get("amount"));
  const reference = formData.get("reference");

  if (!Number.isFinite(amount) || amount === 0) {
    redirect(withStatus(redirectPath, "error", "Enter a non-zero credit amount"));
  }

  try {
    const owner = billingOwnerFromFormData(formData);
    await adminAdjustCredits(owner, amount, context.user.id, typeof reference === "string" ? reference : undefined);
  } catch (error) {
    redirectWithError(redirectPath, error);
  }

  redirect(withStatus(redirectPath, "message", "Credits adjusted."));
}

export async function toggleSubscriptionPlatformStatusAction(formData: FormData) {
  requireFeature("admin");
  const context = await requireAdmin();
  const redirectPath = billingOwnerType === "organization" ? "/admin/organizations" : "/admin/users";
  const disabled = formData.get("disabled") === "true";

  try {
    const owner = billingOwnerFromFormData(formData);
    await setSubscriptionPlatformStatus(context.user.id, owner, disabled);
  } catch (error) {
    redirectWithError(redirectPath, error);
  }

  redirect(
    withStatus(redirectPath, "message", disabled ? "Subscription disabled at the platform level." : "Subscription re-enabled.")
  );
}
