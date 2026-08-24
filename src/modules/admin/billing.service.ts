import { NotFoundError } from "@/lib/errors";
import { logEvent } from "@/lib/events";
import { createAdminClient } from "@/lib/supabase/admin";
import { ownerIdColumn } from "@/modules/billing/billing.service";
import type { BillingOwner } from "@/modules/billing/owner";

/**
 * A platform-level entitlement override, not a Stripe action: toggling this never calls Stripe or
 * touches cancel_at_period_end. getOwnerPlan() filters out any subscription with
 * platform_disabled_at set, so a disabled owner falls back to the "free" plan while their actual
 * Stripe subscription (and its billing) continues untouched.
 */
export async function setSubscriptionPlatformStatus(
  actorId: string,
  owner: BillingOwner,
  disabled: boolean
): Promise<void> {
  const admin = createAdminClient();

  const { data: subscription, error: findError } = await admin
    .from("subscriptions")
    .select("id")
    .eq("owner_type", owner.type)
    .eq(ownerIdColumn(owner), owner.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findError) {
    throw findError;
  }

  if (!subscription) {
    throw new NotFoundError("No subscription found for this owner");
  }

  const { error: updateError } = await admin
    .from("subscriptions")
    .update({ platform_disabled_at: disabled ? new Date().toISOString() : null })
    .eq("id", subscription.id);

  if (updateError) {
    throw updateError;
  }

  await logEvent({
    actorId,
    action: disabled ? "admin.subscription.platform_disabled" : "admin.subscription.platform_enabled",
    entityType: "subscription",
    entityId: subscription.id,
    organizationId: owner.type === "organization" ? owner.id : null,
    metadata: { ownerType: owner.type, ownerId: owner.id }
  });
}
