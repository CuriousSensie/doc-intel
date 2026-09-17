"use server";

import { getLocale, getTranslations } from "next-intl/server";

import { redirect } from "@/i18n/navigation";

import { billingConfig, type BillingPlan } from "@/config/billing";
import { AuthorizationError } from "@/lib/errors";
import { can } from "@/modules/auth/authorization";
import { formDataToObject } from "@/modules/auth/auth.schemas";
import { withStatus } from "@/modules/auth/redirects";
import { requireUser } from "@/modules/auth/session";
import type { AuthContext } from "@/modules/auth/session";
import { checkoutSchema, creditPurchaseSchema } from "@/modules/billing/billing.schemas";
import { createCheckoutSession, createPortalSession } from "@/modules/billing/billing.service";
import { requireBillingOwner, type BillingOwner } from "@/modules/billing/owner";
import { getMembership } from "@/modules/organizations/organizations.service";

async function requireBillingPermission(context: AuthContext, owner: BillingOwner) {
  if (owner.type === "user") {
    return;
  }

  const membership = await getMembership(owner.id, context.user.id);

  if (!membership || !can(membership.role, "organization.billing.manage")) {
    const t = await getTranslations("billing");
    throw new AuthorizationError(t("errors.noPermission"));
  }
}

export async function createCheckoutAction(formData: FormData) {
  const context = await requireUser("/settings/billing");
  const owner = await requireBillingOwner(context);
  await requireBillingPermission(context, owner);
  const [t, locale] = await Promise.all([getTranslations("billing"), getLocale()]);

  const parsed = checkoutSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    return redirect({ href: withStatus("/settings/billing", "error", t("errors.invalidPlanSelection")), locale });
  }

  const plan = billingConfig.plans[parsed.data.planKey] as BillingPlan;
  const priceId = parsed.data.interval === "monthly" ? plan.stripePriceIdMonthly : plan.stripePriceIdYearly;

  if (!priceId) {
    return redirect({ href: withStatus("/settings/billing", "error", t("errors.planNotAvailable")), locale });
  }

  let checkoutUrl: string;

  try {
    checkoutUrl = await createCheckoutSession({
      owner,
      email: context.user.email ?? "",
      priceId,
      mode: "subscription",
      successPath: withStatus("/settings/billing", "message", t("messages.subscriptionUpdated")),
      cancelPath: "/settings/billing"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : t("common.somethingWentWrong");
    return redirect({ href: withStatus("/settings/billing", "error", message), locale });
  }

  return redirect({ href: checkoutUrl, locale });
}

export async function createPortalAction() {
  const context = await requireUser("/settings/billing");
  const owner = await requireBillingOwner(context);
  await requireBillingPermission(context, owner);
  const [t, locale] = await Promise.all([getTranslations("billing"), getLocale()]);

  let portalUrl: string | null;

  try {
    portalUrl = await createPortalSession({ owner, returnPath: "/settings/billing" });
  } catch (error) {
    const message = error instanceof Error ? error.message : t("common.somethingWentWrong");
    return redirect({ href: withStatus("/settings/billing", "error", message), locale });
  }

  if (!portalUrl) {
    return redirect({ href: withStatus("/settings/billing", "error", t("errors.noBillingAccount")), locale });
  }

  return redirect({ href: portalUrl, locale });
}

export async function purchaseCreditsAction(formData: FormData) {
  const context = await requireUser("/settings/billing");
  const owner = await requireBillingOwner(context);
  await requireBillingPermission(context, owner);
  const [t, locale] = await Promise.all([getTranslations("billing"), getLocale()]);

  const parsed = creditPurchaseSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    return redirect({ href: withStatus("/settings/billing", "error", t("errors.invalidCreditPackSelection")), locale });
  }

  const pack = billingConfig.creditPacks.find((candidate) => candidate.key === parsed.data.packKey);

  if (!pack?.stripePriceId) {
    return redirect({ href: withStatus("/settings/billing", "error", t("errors.creditPackNotAvailable")), locale });
  }

  let checkoutUrl: string;

  try {
    checkoutUrl = await createCheckoutSession({
      owner,
      email: context.user.email ?? "",
      priceId: pack.stripePriceId,
      mode: "payment",
      successPath: withStatus("/settings/billing", "message", t("messages.creditsPurchased")),
      cancelPath: "/settings/billing",
      metadata: { creditPackKey: pack.key }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : t("common.somethingWentWrong");
    return redirect({ href: withStatus("/settings/billing", "error", message), locale });
  }

  return redirect({ href: checkoutUrl, locale });
}
