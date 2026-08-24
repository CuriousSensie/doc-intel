import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/lib/events");
  vi.doUnmock("@/lib/supabase/admin");
  vi.doUnmock("@/modules/billing/billing.service");
  vi.resetModules();
});

describe("setSubscriptionPlatformStatus", () => {
  it("throws when the owner has no subscription", async () => {
    vi.doMock("@/modules/billing/billing.service", () => ({ ownerIdColumn: () => "user_id" }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
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
    }));

    const { setSubscriptionPlatformStatus } = await import("@/modules/admin/billing.service");

    await expect(
      setSubscriptionPlatformStatus("admin-1", { type: "user", id: "user-1" }, true)
    ).rejects.toThrow("No subscription found");
  });

  it("sets platform_disabled_at on the owner's most recent subscription and logs it", async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq: updateEq }));
    const logEvent = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/lib/events", () => ({ logEvent }));
    vi.doMock("@/modules/billing/billing.service", () => ({ ownerIdColumn: () => "user_id" }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: () => Promise.resolve({ data: { id: "sub-1" }, error: null })
                  })
                })
              })
            })
          }),
          update
        })
      })
    }));

    const { setSubscriptionPlatformStatus } = await import("@/modules/admin/billing.service");
    await setSubscriptionPlatformStatus("admin-1", { type: "user", id: "user-1" }, true);

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ platform_disabled_at: expect.any(String) }));
    expect(updateEq).toHaveBeenCalledWith("id", "sub-1");
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.subscription.platform_disabled", entityId: "sub-1" })
    );
  });
});
