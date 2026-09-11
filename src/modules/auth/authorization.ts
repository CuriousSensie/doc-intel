import { AuthorizationError } from "@/lib/errors";
import { billingConfig, type PlanKey } from "@/config/billing";
import { type FeatureKey, isFeatureEnabled } from "@/config/features";
import { getOwnerPlan } from "@/modules/billing/billing.service";
import type { BillingOwner } from "@/modules/billing/owner";

export function requireFeature(feature: FeatureKey) {
  if (!isFeatureEnabled(feature)) {
    throw new AuthorizationError(`Feature is disabled: ${feature}`);
  }
}

export function hasFeature(
  plan: PlanKey,
  feature: keyof (typeof billingConfig.plans)[PlanKey]["features"]
) {
  return billingConfig.plans[plan].features[feature] > 0;
}

export function getLimit(
  plan: PlanKey,
  limit: keyof (typeof billingConfig.plans)[PlanKey]["features"]
) {
  return billingConfig.plans[plan].features[limit];
}

export async function requireSubscription(
  owner: BillingOwner,
  allowedPlans: PlanKey[]
): Promise<PlanKey> {
  const plan = await getOwnerPlan(owner);

  if (!allowedPlans.includes(plan)) {
    throw new AuthorizationError(
      `This action requires one of the following plans: ${allowedPlans.join(", ")}`
    );
  }

  return plan;
}

export function can(role: "owner" | "admin" | "member" | "read-only", permission: string) {
  const permissions: Record<typeof role, string[]> = {
    owner: ["organization.*"],
    admin: [
      "organization.billing.manage",
      "organization.members.invite",
      "organization.settings.manage",
      "organization.files.manage"
    ],
    member: ["organization.read"],
    // A viewer role (specs/00-overview.md's RBAC minimum) — read access identical to member,
    // never write. RLS (has_organization_write_access(), supabase/migrations/
    // 20260824000000_pomocnik_orgs_extension.sql) is the real enforcement boundary for this;
    // this entry exists so callers of can() get a fast, clear "no" without a round trip.
    "read-only": ["organization.read"]
  };

  return permissions[role].some((allowed) => {
    if (allowed.endsWith(".*")) {
      return permission.startsWith(allowed.slice(0, -1));
    }

    return allowed === permission;
  });
}
