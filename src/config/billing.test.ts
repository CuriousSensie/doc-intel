import { describe, expect, it } from "vitest";

import { billingConfig, billingOwnerType } from "@/config/billing";
import { featureConfig } from "@/config/features";

describe("billingConfig", () => {
  it("derives billing ownership from the organizations feature flag, not an independent setting", () => {
    expect(billingOwnerType).toBe(featureConfig.organizations ? "organization" : "user");
  });

  it("keeps an organization-ready team plan available", () => {
    expect(billingConfig.plans.team.features.teamMembers).toBeGreaterThan(1);
  });
});
