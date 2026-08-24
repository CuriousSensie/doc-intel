import { billingConfig, type BillingPlan, type PlanKey } from "@/config/billing";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/stripe/client";
import { absoluteUrl } from "@/lib/utils";
import type { BillingOwner } from "@/modules/billing/owner";

function ownerColumns(owner: BillingOwner) {
  return owner.type === "user"
    ? { owner_type: "user" as const, user_id: owner.id, organization_id: null }
    : { owner_type: "organization" as const, user_id: null, organization_id: owner.id };
}

export function ownerIdColumn(owner: BillingOwner) {
  return owner.type === "user" ? ("user_id" as const) : ("organization_id" as const);
}

export async function getStripeCustomerId(owner: BillingOwner, email: string): Promise<string> {
  const admin = createAdminClient();

  const { data: existing, error } = await admin
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("owner_type", owner.type)
    .eq(ownerIdColumn(owner), owner.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (existing) {
    return existing.stripe_customer_id;
  }

  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    email,
    metadata: { ownerType: owner.type, ownerId: owner.id }
  });

  const { error: insertError } = await admin.from("stripe_customers").insert({
    ...ownerColumns(owner),
    stripe_customer_id: customer.id
  });

  if (insertError) {
    throw insertError;
  }

  return customer.id;
}

export async function getOwnerPlan(owner: BillingOwner): Promise<PlanKey> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("subscriptions")
    .select("plan_key, status")
    .eq("owner_type", owner.type)
    .eq(ownerIdColumn(owner), owner.id)
    .in("status", ["active", "trialing"])
    .is("platform_disabled_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data || !(data.plan_key in billingConfig.plans)) {
    return "free";
  }

  return data.plan_key as PlanKey;
}

export function resolvePlanKeyFromPriceId(priceId: string): PlanKey | null {
  for (const plan of Object.values(billingConfig.plans) as BillingPlan[]) {
    if (plan.stripePriceIdMonthly === priceId || plan.stripePriceIdYearly === priceId) {
      return plan.key;
    }
  }

  return null;
}

export async function createCheckoutSession({
  owner,
  email,
  priceId,
  mode,
  successPath,
  cancelPath,
  metadata
}: {
  owner: BillingOwner;
  email: string;
  priceId: string;
  mode: "subscription" | "payment";
  successPath: string;
  cancelPath: string;
  metadata?: Record<string, string>;
}): Promise<string> {
  const stripe = getStripeClient();
  const customerId = await getStripeCustomerId(owner, email);

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: absoluteUrl(successPath),
    cancel_url: absoluteUrl(cancelPath),
    metadata: {
      ownerType: owner.type,
      ownerId: owner.id,
      ...metadata
    }
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL");
  }

  return session.url;
}

export async function hasStripeCustomer(owner: BillingOwner): Promise<boolean> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("stripe_customers")
    .select("id")
    .eq("owner_type", owner.type)
    .eq(ownerIdColumn(owner), owner.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

export async function createPortalSession({
  owner,
  returnPath
}: {
  owner: BillingOwner;
  returnPath: string;
}): Promise<string | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("owner_type", owner.type)
    .eq(ownerIdColumn(owner), owner.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const stripe = getStripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: data.stripe_customer_id,
    return_url: absoluteUrl(returnPath)
  });

  return session.url;
}
