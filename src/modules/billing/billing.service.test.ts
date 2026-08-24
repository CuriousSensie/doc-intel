import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/supabase/admin");
  vi.resetModules();
});

describe("resolvePlanKeyFromPriceId", () => {
  it("returns null for an unknown price id", async () => {
    const { resolvePlanKeyFromPriceId } = await import("@/modules/billing/billing.service");

    expect(resolvePlanKeyFromPriceId("price_unknown")).toBeNull();
  });

  it("maps a configured monthly price id back to its plan", async () => {
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_pro_monthly_test");

    const { resolvePlanKeyFromPriceId } = await import("@/modules/billing/billing.service");

    expect(resolvePlanKeyFromPriceId("price_pro_monthly_test")).toBe("pro");
  });
});

describe("getOwnerPlan", () => {
  it("falls back to the free plan when no active/trialing subscription exists", async () => {
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: () => ({
                  is: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: () => Promise.resolve({ data: null, error: null })
                      })
                    })
                  })
                })
              })
            })
          })
        })
      })
    }));

    const { getOwnerPlan } = await import("@/modules/billing/billing.service");
    const plan = await getOwnerPlan({ type: "user", id: "user-1" });

    expect(plan).toBe("free");
  });
});
