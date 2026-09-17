"use server";

import { getLocale, getTranslations } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

import { billingOwnerType } from "@/config/billing";
import type { BillingOwner } from "@/modules/billing/owner";
import { adminAdjustCredits } from "@/modules/billing/credits.service";
import { requireFeature } from "@/modules/auth/authorization";
import { withStatus } from "@/modules/auth/redirects";
import { requireAdmin } from "@/modules/auth/session";
import { setSubscriptionPlatformStatus } from "@/modules/admin/billing.service";
import {
  deleteOrganizationAdmin,
  reprovisionOrganizationAdmin,
  suspendOrganization,
  unsuspendOrganization
} from "@/modules/admin/organizations.service";
import {
  deleteUserAdmin,
  setAppAdmin,
  suspendUser,
  unsuspendUser
} from "@/modules/admin/users.service";

type Translator = Awaited<ReturnType<typeof getTranslations>>;

function redirectWithError(path: string, error: unknown, t: Translator, locale: Locale): never {
  const message = error instanceof Error ? error.message : t("actions.genericError");
  return redirect({ href: withStatus(path, "error", message), locale });
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
  const [t, locale] = await Promise.all([getTranslations("admin"), getLocale()]);

  try {
    await suspendUser(context.user.id, requiredString(formData, "userId"));
  } catch (error) {
    redirectWithError("/admin/users", error, t, locale);
  }

  return redirect({ href: withStatus("/admin/users", "message", t("actions.userSuspended")), locale });
}

export async function unsuspendUserAction(formData: FormData) {
  requireFeature("admin");
  const context = await requireAdmin();
  const [t, locale] = await Promise.all([getTranslations("admin"), getLocale()]);

  try {
    await unsuspendUser(context.user.id, requiredString(formData, "userId"));
  } catch (error) {
    redirectWithError("/admin/users", error, t, locale);
  }

  return redirect({ href: withStatus("/admin/users", "message", t("actions.userUnsuspended")), locale });
}

export async function setAppAdminAction(formData: FormData) {
  requireFeature("admin");
  const context = await requireAdmin();
  const isAdmin = formData.get("isAdmin") === "true";
  const [t, locale] = await Promise.all([getTranslations("admin"), getLocale()]);

  try {
    await setAppAdmin(context.user.id, requiredString(formData, "userId"), isAdmin);
  } catch (error) {
    redirectWithError("/admin/users", error, t, locale);
  }

  return redirect({
    href: withStatus("/admin/users", "message", isAdmin ? t("actions.adminGranted") : t("actions.adminRevoked")),
    locale
  });
}

export async function deleteUserAdminAction(formData: FormData) {
  requireFeature("admin");
  const context = await requireAdmin();
  const [t, locale] = await Promise.all([getTranslations("admin"), getLocale()]);

  try {
    await deleteUserAdmin(context.user.id, requiredString(formData, "userId"));
  } catch (error) {
    redirectWithError("/admin/users", error, t, locale);
  }

  return redirect({ href: withStatus("/admin/users", "message", t("actions.userDeleted")), locale });
}

export async function suspendOrganizationAction(formData: FormData) {
  requireFeature("admin");
  const context = await requireAdmin();
  const [t, locale] = await Promise.all([getTranslations("admin"), getLocale()]);

  try {
    await suspendOrganization(context.user.id, requiredString(formData, "organizationId"));
  } catch (error) {
    redirectWithError("/admin/organizations", error, t, locale);
  }

  return redirect({
    href: withStatus("/admin/organizations", "message", t("actions.organizationSuspended")),
    locale
  });
}

export async function unsuspendOrganizationAction(formData: FormData) {
  requireFeature("admin");
  const context = await requireAdmin();
  const [t, locale] = await Promise.all([getTranslations("admin"), getLocale()]);

  try {
    await unsuspendOrganization(context.user.id, requiredString(formData, "organizationId"));
  } catch (error) {
    redirectWithError("/admin/organizations", error, t, locale);
  }

  return redirect({
    href: withStatus("/admin/organizations", "message", t("actions.organizationUnsuspended")),
    locale
  });
}

export async function deleteOrganizationAdminAction(formData: FormData) {
  requireFeature("admin");
  const context = await requireAdmin();
  const [t, locale] = await Promise.all([getTranslations("admin"), getLocale()]);

  try {
    await deleteOrganizationAdmin(context.user.id, requiredString(formData, "organizationId"));
  } catch (error) {
    redirectWithError("/admin/organizations", error, t, locale);
  }

  return redirect({
    href: withStatus("/admin/organizations", "message", t("actions.organizationDeleted")),
    locale
  });
}

export async function reprovisionOrganizationAction(formData: FormData) {
  requireFeature("admin");
  const context = await requireAdmin();
  const [t, locale] = await Promise.all([getTranslations("admin"), getLocale()]);

  try {
    await reprovisionOrganizationAdmin(context.user.id, requiredString(formData, "organizationId"));
  } catch (error) {
    redirectWithError("/admin/organizations", error, t, locale);
  }

  return redirect({
    href: withStatus("/admin/organizations", "message", t("actions.reprovisioningQueued")),
    locale
  });
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
  const [t, locale] = await Promise.all([getTranslations("admin"), getLocale()]);

  if (!Number.isFinite(amount) || amount === 0) {
    return redirect({ href: withStatus(redirectPath, "error", t("actions.creditAmountRequired")), locale });
  }

  try {
    const owner = billingOwnerFromFormData(formData);
    await adminAdjustCredits(
      owner,
      amount,
      context.user.id,
      typeof reference === "string" ? reference : undefined
    );
  } catch (error) {
    redirectWithError(redirectPath, error, t, locale);
  }

  return redirect({ href: withStatus(redirectPath, "message", t("actions.creditsAdjusted")), locale });
}

export async function toggleSubscriptionPlatformStatusAction(formData: FormData) {
  requireFeature("admin");
  const context = await requireAdmin();
  const redirectPath = billingOwnerType === "organization" ? "/admin/organizations" : "/admin/users";
  const disabled = formData.get("disabled") === "true";
  const [t, locale] = await Promise.all([getTranslations("admin"), getLocale()]);

  try {
    const owner = billingOwnerFromFormData(formData);
    await setSubscriptionPlatformStatus(context.user.id, owner, disabled);
  } catch (error) {
    redirectWithError(redirectPath, error, t, locale);
  }

  return redirect({
    href: withStatus(
      redirectPath,
      "message",
      disabled ? t("actions.subscriptionDisabled") : t("actions.subscriptionEnabled")
    ),
    locale
  });
}
