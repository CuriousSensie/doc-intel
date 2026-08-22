import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/config/features");
  vi.doUnmock("@/lib/supabase/admin");
  vi.resetModules();
});

describe("createNotification", () => {
  it("does nothing and never touches the database when the feature flag is off", async () => {
    const insert = vi.fn();

    vi.doMock("@/config/features", () => ({ isFeatureEnabled: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ from: () => ({ insert }) })
    }));

    const { createNotification } = await import("@/modules/notifications/notifications.service");
    await createNotification("user-1", { type: "test", title: "Hi", message: "Hello" });

    expect(insert).not.toHaveBeenCalled();
  });

  it("inserts via the admin client when the feature flag is on", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });

    vi.doMock("@/config/features", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ from: () => ({ insert }) })
    }));

    const { createNotification } = await import("@/modules/notifications/notifications.service");
    await createNotification("user-1", { type: "test", title: "Hi", message: "Hello" });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", type: "test", title: "Hi", message: "Hello" })
    );
  });
});
