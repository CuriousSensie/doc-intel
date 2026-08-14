import { describe, expect, it } from "vitest";

import { featureConfig, isFeatureEnabled } from "@/config/features";

describe("featureConfig", () => {
  it("keeps analytics and api keys out of the foundation scope", () => {
    expect("analytics" in featureConfig).toBe(false);
    expect("apiKeys" in featureConfig).toBe(false);
  });

  it("enables required planned modules", () => {
    expect(isFeatureEnabled("billing")).toBe(true);
    expect(isFeatureEnabled("organizations")).toBe(true);
    expect(isFeatureEnabled("admin")).toBe(true);
  });
});
