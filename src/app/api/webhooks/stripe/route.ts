import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { billingConfig } from "@/config/billing";
import { requireEnv } from "@/lib/env";
import { logEvent } from "@/lib/events";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/stripe/client";
import { resolvePlanKeyFromPriceId } from "@/modules/billing/billing.service";
import { grantCredits } from "@/modules/billing/credits.service";
import type { BillingOwner } from "@/modules/billing/owner";
import type { Json } from "@/types/database";

export const dynamic = "force-dynamic";

type AdminClient = ReturnType<typeof createAdminClient>;

function ownerFromMetadata(metadata: Stripe.Metadata | null | undefined): BillingOwner | null {
  const ownerType = metadata?.ownerType;
  const ownerId = metadata?.ownerId;

  if ((ownerType === "user" || ownerType === "organization") && ownerId) {
    return { type: ownerType, id: ownerId };
  }

  return null;
}

async function ownerFromCustomerId(admin: AdminClient, customerId: string): Promise<BillingOwner | null> {
  const { data } = await admin
    .from("stripe_customers")
    .select("owner_type, user_id, organization_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (!data) {
    return null;
  }

  return data.owner_type === "user"
    ? { type: "user", id: data.user_id as string }
    : { type: "organization", id: data.organization_id as string };
}

function ownerColumns(owner: BillingOwner) {
  return owner.type === "user"
    ? { owner_type: "user" as const, user_id: owner.id, organization_id: null }
    : { owner_type: "organization" as const, user_id: null, organization_id: owner.id };
}

/**
 * Stripe's "incomplete_expired" status (the initial payment never completed in time) has no
 * corresponding value in our subscription_status enum — treat it the same as a subscription that
 * never became active.
 */
function mapSubscriptionStatus(status: Stripe.Subscription.Status) {
  return status === "incomplete_expired" ? "canceled" : status;
}

async function upsertSubscription(
  admin: AdminClient,
  owner: BillingOwner,
  customerId: string,
  subscription: Stripe.Subscription
) {
  const item = subscription.items.data[0];
  const priceId = item?.price.id;
  const planKey = (priceId && resolvePlanKeyFromPriceId(priceId)) ?? "free";

  const { error } = await admin.from("subscriptions").upsert(
    {
      ...ownerColumns(owner),
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceId ?? null,
      plan_key: planKey,
      status: mapSubscriptionStatus(subscription.status),
      current_period_start: item ? new Date(item.current_period_start * 1000).toISOString() : null,
      current_period_end: item ? new Date(item.current_period_end * 1000).toISOString() : null,
      cancel_at_period_end: subscription.cancel_at_period_end
    },
    { onConflict: "stripe_subscription_id" }
  );

  if (error) {
    throw error;
  }

  await logEvent({
    actorId: null,
    action: "billing.subscription.updated",
    entityType: "subscription",
    entityId: subscription.id,
    organizationId: owner.type === "organization" ? owner.id : null,
    metadata: { ownerType: owner.type, ownerId: owner.id, status: subscription.status, planKey }
  });
}

async function handleCheckoutSessionCompleted(admin: AdminClient, session: Stripe.Checkout.Session) {
  const owner = ownerFromMetadata(session.metadata);

  if (!owner) {
    logger.warn("billing.webhook.missing_owner", { event: "checkout.session.completed", sessionId: session.id });
    return;
  }

  if (session.mode === "subscription" && session.subscription) {
    const stripe = getStripeClient();
    const subscriptionId =
      typeof session.subscription === "string" ? session.subscription : session.subscription.id;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await upsertSubscription(admin, owner, session.customer as string, subscription);
    return;
  }

  if (session.mode === "payment") {
    const packKey = session.metadata?.creditPackKey;
    const pack = billingConfig.creditPacks.find((candidate) => candidate.key === packKey);

    if (!pack) {
      logger.warn("billing.webhook.unknown_credit_pack", { sessionId: session.id, packKey: packKey ?? null });
      return;
    }

    await grantCredits(owner, pack.credits, "purchase", { reference: session.id });
    await logEvent({
      actorId: null,
      action: "billing.credits.purchased",
      entityType: "credit_pack",
      entityId: pack.key,
      organizationId: owner.type === "organization" ? owner.id : null,
      metadata: { ownerType: owner.type, ownerId: owner.id, credits: pack.credits }
    });
  }
}

async function handleSubscriptionUpdated(admin: AdminClient, subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const owner = ownerFromMetadata(subscription.metadata) ?? (await ownerFromCustomerId(admin, customerId));

  if (!owner) {
    logger.warn("billing.webhook.missing_owner", { event: "customer.subscription.updated", customerId });
    return;
  }

  await upsertSubscription(admin, owner, customerId, subscription);
}

async function handleInvoicePaid(admin: AdminClient, invoice: Stripe.Invoice) {
  const subscriptionId = invoice.parent?.subscription_details?.subscription;

  if (!subscriptionId) {
    return;
  }

  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(
    typeof subscriptionId === "string" ? subscriptionId : subscriptionId.id
  );
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;

  if (!customerId) {
    return;
  }

  const owner = ownerFromMetadata(subscription.metadata) ?? (await ownerFromCustomerId(admin, customerId));

  if (!owner) {
    logger.warn("billing.webhook.missing_owner", { event: "invoice.paid", customerId });
    return;
  }

  const priceId = subscription.items.data[0]?.price.id;
  const planKey = priceId ? resolvePlanKeyFromPriceId(priceId) : null;
  const monthlyCredits = planKey ? billingConfig.plans[planKey].features.credits : 0;

  if (monthlyCredits > 0) {
    await grantCredits(owner, monthlyCredits, "subscription_grant", { reference: invoice.id });
  }
}

async function dispatchEvent(admin: AdminClient, event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted(admin, event.data.object);
      return;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await handleSubscriptionUpdated(admin, event.data.object);
      return;
    case "invoice.paid":
      await handleInvoicePaid(admin, event.data.object);
      return;
    default:
      return;
  }
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const payload = await request.text();
  const stripe = getStripeClient();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, requireEnv("STRIPE_WEBHOOK_SECRET"));
  } catch (error) {
    logger.warn("billing.webhook.invalid_signature", {
      errorMessage: error instanceof Error ? error.message : "Unknown error"
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("webhook_events")
    .select("status")
    .eq("provider", "stripe")
    .eq("event_id", event.id)
    .maybeSingle();

  if (existing?.status === "processed") {
    return NextResponse.json({ received: true, deduped: true });
  }

  if (!existing) {
    const { error: insertError } = await admin.from("webhook_events").insert({
      provider: "stripe",
      event_id: event.id,
      event_type: event.type,
      status: "pending",
      payload: event as unknown as Json
    });

    if (insertError && insertError.code !== "23505") {
      logger.error("billing.webhook.record_failed", { eventId: event.id, errorMessage: insertError.message });
      return NextResponse.json({ error: "Failed to record webhook event" }, { status: 500 });
    }
  }

  try {
    await dispatchEvent(admin, event);
    await admin
      .from("webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString(), error: null })
      .eq("provider", "stripe")
      .eq("event_id", event.id);

    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("billing.webhook.processing_failed", { eventId: event.id, eventType: event.type, errorMessage: message });

    await admin
      .from("webhook_events")
      .update({ status: "failed", error: message })
      .eq("provider", "stripe")
      .eq("event_id", event.id);

    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
