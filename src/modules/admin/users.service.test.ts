import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/lib/events");
  vi.doUnmock("@/lib/supabase/admin");
  vi.resetModules();
});

describe("self-lockout guards", () => {
  it("suspendUser rejects an actor targeting themselves without touching the database", async () => {
    const from = vi.fn();
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));

    const { suspendUser } = await import("@/modules/admin/users.service");
    await expect(suspendUser("user-1", "user-1")).rejects.toThrow("cannot suspend your own account");
    expect(from).not.toHaveBeenCalled();
  });

  it("setAppAdmin rejects an actor revoking their own admin status", async () => {
    const from = vi.fn();
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));

    const { setAppAdmin } = await import("@/modules/admin/users.service");
    await expect(setAppAdmin("user-1", "user-1", false)).rejects.toThrow("cannot revoke your own admin access");
    expect(from).not.toHaveBeenCalled();
  });

  it("deleteUserAdmin rejects an actor targeting themselves without touching the database", async () => {
    const from = vi.fn();
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));

    const { deleteUserAdmin } = await import("@/modules/admin/users.service");
    await expect(deleteUserAdmin("user-1", "user-1")).rejects.toThrow("cannot delete your own account");
    expect(from).not.toHaveBeenCalled();
  });
});

describe("deleteUserAdmin cascade", () => {
  it("deletes an organization the target user solely owns, then deletes the user", async () => {
    const deleteOrgEq = vi.fn().mockResolvedValue({ error: null });
    const deleteUser = vi.fn().mockResolvedValue({ error: null });

    const from = vi.fn((table: string) => {
      if (table === "organization_members") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                then: (resolve: (value: unknown) => void) =>
                  resolve({ data: [{ organization_id: "org-1" }], error: null }),
                neq: () => Promise.resolve({ count: 0, error: null })
              })
            })
          })
        };
      }

      if (table === "organizations") {
        return { delete: () => ({ eq: deleteOrgEq }) };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    vi.doMock("@/lib/events", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ from, auth: { admin: { deleteUser } } })
    }));

    const { deleteUserAdmin } = await import("@/modules/admin/users.service");
    await deleteUserAdmin("admin-1", "user-2");

    expect(deleteOrgEq).toHaveBeenCalledWith("id", "org-1");
    expect(deleteUser).toHaveBeenCalledWith("user-2");
  });

  it("leaves a co-owned organization alone, but still deletes the user", async () => {
    const deleteOrgEq = vi.fn();
    const deleteUser = vi.fn().mockResolvedValue({ error: null });

    const from = vi.fn((table: string) => {
      if (table === "organization_members") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                then: (resolve: (value: unknown) => void) =>
                  resolve({ data: [{ organization_id: "org-1" }], error: null }),
                neq: () => Promise.resolve({ count: 1, error: null })
              })
            })
          })
        };
      }

      if (table === "organizations") {
        return { delete: () => ({ eq: deleteOrgEq }) };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    vi.doMock("@/lib/events", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ from, auth: { admin: { deleteUser } } })
    }));

    const { deleteUserAdmin } = await import("@/modules/admin/users.service");
    await deleteUserAdmin("admin-1", "user-2");

    expect(deleteOrgEq).not.toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledWith("user-2");
  });
});
