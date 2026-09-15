import { getLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";

import { billingOwnerType } from "@/config/billing";
import type { AuthContext } from "@/modules/auth/session";
import { getActiveOrganizationId } from "@/modules/organizations/active-organization";

export type BillingOwner = { type: "user"; id: string } | { type: "organization"; id: string };

/**
 * The single place that decides which entity billing applies to. Every other billing/usage/credit
 * function takes a BillingOwner and never branches on featureConfig.organizations itself — that
 * keeps user-billed and organization-billed products served by the same code paths.
 */
export async function resolveBillingOwner(context: AuthContext): Promise<BillingOwner | null> {
  if (billingOwnerType === "user") {
    return { type: "user", id: context.user.id };
  }

  const organizationId = await getActiveOrganizationId(context.user.id);

  if (!organizationId) {
    return null;
  }

  return { type: "organization", id: organizationId };
}

export async function requireBillingOwner(context: AuthContext): Promise<BillingOwner> {
  const owner = await resolveBillingOwner(context);

  if (!owner) {
    const locale = await getLocale();
    return redirect({ href: "/organizations/new", locale });
  }

  return owner;
}
