import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/lib/events");
  vi.doUnmock("@/lib/supabase/admin");
  vi.resetModules();
});

describe("suspendOrganization / unsuspendOrganization", () => {
  it("suspendOrganization sets suspended_at and logs the event", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    const logEvent = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/lib/events", () => ({ logEvent }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ from: () => ({ update }) })
    }));

    const { suspendOrganization } = await import("@/modules/admin/organizations.service");
    await suspendOrganization("admin-1", "org-1");

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ suspended_at: expect.any(String) }));
    expect(eq).toHaveBeenCalledWith("id", "org-1");
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.organization.suspended", entityId: "org-1" })
    );
  });

  it("unsuspendOrganization clears suspended_at", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));

    vi.doMock("@/lib/events", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ from: () => ({ update }) })
    }));

    const { unsuspendOrganization } = await import("@/modules/admin/organizations.service");
    await unsuspendOrganization("admin-1", "org-1");

    expect(update).toHaveBeenCalledWith({ suspended_at: null });
  });
});

describe("deleteOrganizationAdmin", () => {
  it("logs the event before deleting the row, so the organization_id FK is still satisfiable", async () => {
    const calls: string[] = [];
    const eq = vi.fn(() => {
      calls.push("delete");
      return Promise.resolve({ error: null });
    });

    vi.doMock("@/lib/events", () => ({
      logEvent: vi.fn(async () => {
        calls.push("log");
      })
    }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ from: () => ({ delete: () => ({ eq }) }) })
    }));

    const { deleteOrganizationAdmin } = await import("@/modules/admin/organizations.service");
    await deleteOrganizationAdmin("admin-1", "org-1");

    expect(calls).toEqual(["log", "delete"]);
    expect(eq).toHaveBeenCalledWith("id", "org-1");
  });
});
