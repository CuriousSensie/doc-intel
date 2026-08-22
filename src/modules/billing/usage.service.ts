import { billingConfig, type PlanFeatureMap } from "@/config/billing";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOwnerPlan } from "@/modules/billing/billing.service";
import type { BillingOwner } from "@/modules/billing/owner";

type UsageFeature = keyof PlanFeatureMap;
type UsageInterval = "daily" | "monthly" | "lifetime";

function ownerIdColumn(owner: BillingOwner) {
  return owner.type === "user" ? ("user_id" as const) : ("organization_id" as const);
}

export function currentUsagePeriod(interval: UsageInterval = "monthly"): string {
  if (interval === "lifetime") {
    return "lifetime";
  }

  const now = new Date().toISOString();
  return interval === "daily" ? now.slice(0, 10) : now.slice(0, 7);
}

export async function getUsage(owner: BillingOwner, feature: UsageFeature, period: string): Promise<number> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("usage_counters")
    .select("quantity")
    .eq("owner_type", owner.type)
    .eq(ownerIdColumn(owner), owner.id)
    .eq("feature", feature)
    .eq("period", period)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.quantity ?? 0;
}

export async function checkUsageLimit(owner: BillingOwner, feature: UsageFeature, period: string) {
  const plan = await getOwnerPlan(owner);
  const limit = billingConfig.plans[plan].features[feature];
  const used = await getUsage(owner, feature, period);

  return { used, limit, remaining: Math.max(limit - used, 0), exceeded: used >= limit };
}

export async function incrementUsage(
  owner: BillingOwner,
  feature: UsageFeature,
  period: string,
  amount = 1
): Promise<number> {
  const plan = await getOwnerPlan(owner);
  const limit = billingConfig.plans[plan].features[feature];

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("increment_usage_counter", {
    p_owner_type: owner.type,
    p_user_id: owner.type === "user" ? owner.id : null,
    p_organization_id: owner.type === "organization" ? owner.id : null,
    p_feature: feature,
    p_period: period,
    p_amount: amount,
    p_limit: limit
  });

  if (error) {
    throw error;
  }

  return data;
}
