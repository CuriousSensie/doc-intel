import { AuthorizationError } from "@/lib/errors";
import { billingConfig, type PlanKey } from "@/config/billing";
import { type FeatureKey, isFeatureEnabled } from "@/config/features";

export function requireFeature(feature: FeatureKey) {
  if (!isFeatureEnabled(feature)) {
    throw new AuthorizationError(`Feature is disabled: ${feature}`);
  }
}

export function hasFeature(plan: PlanKey, feature: keyof (typeof billingConfig.plans)[PlanKey]["features"]) {
  return billingConfig.plans[plan].features[feature] > 0;
}

export function getLimit(plan: PlanKey, limit: keyof (typeof billingConfig.plans)[PlanKey]["features"]) {
  return billingConfig.plans[plan].features[limit];
}

export function can(role: "owner" | "admin" | "member", permission: string) {
  const permissions: Record<typeof role, string[]> = {
    owner: ["organization.*"],
    admin: ["organization.billing.manage", "organization.members.invite", "organization.settings.manage"],
    member: ["organization.read"]
  };

  return permissions[role].some((allowed) => {
    if (allowed.endsWith(".*")) {
      return permission.startsWith(allowed.slice(0, -1));
    }

    return allowed === permission;
  });
}
