"use server";

import { redirect } from "next/navigation";

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

function redirectWithError(error: unknown): never {
  const message = error instanceof Error ? error.message : "Something went wrong";
  redirect(withStatus("/settings/billing", "error", message));
}

async function requireBillingPermission(context: AuthContext, owner: BillingOwner) {
  if (owner.type === "user") {
    return;
  }

  const membership = await getMembership(owner.id, context.user.id);

  if (!membership || !can(membership.role, "organization.billing.manage")) {
    throw new AuthorizationError("You do not have permission to manage billing for this organization");
  }
}

export async function createCheckoutAction(formData: FormData) {
  const context = await requireUser("/settings/billing");
  const owner = await requireBillingOwner(context);
  await requireBillingPermission(context, owner);

  const parsed = checkoutSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    redirect(withStatus("/settings/billing", "error", "Invalid plan selection"));
  }

  const plan = billingConfig.plans[parsed.data.planKey] as BillingPlan;
  const priceId = parsed.data.interval === "monthly" ? plan.stripePriceIdMonthly : plan.stripePriceIdYearly;

  if (!priceId) {
    redirect(withStatus("/settings/billing", "error", "This plan is not available for checkout yet"));
  }

  let checkoutUrl: string;

  try {
    checkoutUrl = await createCheckoutSession({
      owner,
      email: context.user.email ?? "",
      priceId,
      mode: "subscription",
      successPath: withStatus("/settings/billing", "message", "Subscription updated."),
      cancelPath: "/settings/billing"
    });
  } catch (error) {
    redirectWithError(error);
  }

  redirect(checkoutUrl);
}

export async function createPortalAction() {
  const context = await requireUser("/settings/billing");
  const owner = await requireBillingOwner(context);
  await requireBillingPermission(context, owner);

  let portalUrl: string | null;

  try {
    portalUrl = await createPortalSession({ owner, returnPath: "/settings/billing" });
  } catch (error) {
    redirectWithError(error);
  }

  if (!portalUrl) {
    redirect(withStatus("/settings/billing", "error", "No billing account found yet"));
  }

  redirect(portalUrl);
}

export async function purchaseCreditsAction(formData: FormData) {
  const context = await requireUser("/settings/billing");
  const owner = await requireBillingOwner(context);
  await requireBillingPermission(context, owner);

  const parsed = creditPurchaseSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    redirect(withStatus("/settings/billing", "error", "Invalid credit pack selection"));
  }

  const pack = billingConfig.creditPacks.find((candidate) => candidate.key === parsed.data.packKey);

  if (!pack?.stripePriceId) {
    redirect(withStatus("/settings/billing", "error", "This credit pack is not available for purchase yet"));
  }

  let checkoutUrl: string;

  try {
    checkoutUrl = await createCheckoutSession({
      owner,
      email: context.user.email ?? "",
      priceId: pack.stripePriceId,
      mode: "payment",
      successPath: withStatus("/settings/billing", "message", "Credits purchased."),
      cancelPath: "/settings/billing",
      metadata: { creditPackKey: pack.key }
    });
  } catch (error) {
    redirectWithError(error);
  }

  redirect(checkoutUrl);
}
