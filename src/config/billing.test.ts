import { describe, expect, it } from "vitest";

import { billingConfig } from "@/config/billing";

describe("billingConfig", () => {
  it("defaults billing ownership to user accounts", () => {
    expect(billingConfig.defaultOwner).toBe("user");
  });

  it("keeps an organization-ready team plan available", () => {
    expect(billingConfig.plans.team.features.teamMembers).toBeGreaterThan(1);
  });
});
