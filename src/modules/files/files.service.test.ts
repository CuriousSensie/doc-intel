import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "@/modules/auth/session";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const actor = { user: { id: "user-1" }, profile: null } as AuthContext;

afterEach(() => {
  vi.doUnmock("@/lib/events");
  vi.doUnmock("@/lib/supabase/admin");
  vi.doUnmock("@/lib/supabase/server");
  vi.doUnmock("@/modules/organizations/active-organization");
  vi.doUnmock("@/modules/organizations/organizations.service");
  vi.resetModules();
});

describe("uploadFile", () => {
  it("stores the row with no organization when organizations are disabled, and cleans up on insert failure", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const single = vi.fn().mockResolvedValue({ data: null, error: new Error("insert failed") });
    const insert = vi.fn(() => ({ select: () => ({ single }) }));

    vi.doMock("@/modules/organizations/active-organization", () => ({
      getActiveOrganizationId: vi.fn().mockResolvedValue(null)
    }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        storage: { from: () => ({ upload, remove }) },
        from: () => ({ insert })
      })
    }));

    const { uploadFile } = await import("@/modules/files/files.service");

    await expect(
      uploadFile(actor, { buffer: PNG_BYTES, filename: "logo.png", declaredMimeType: "image/png", size: PNG_BYTES.length })
    ).rejects.toThrow("insert failed");

    expect(upload).toHaveBeenCalledWith(expect.stringContaining("user-1/"), PNG_BYTES, {
      contentType: "image/png",
      upsert: false
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ owner_id: "user-1", organization_id: null, mime_type: "image/png" })
    );
    expect(remove).toHaveBeenCalled();
  });
});

describe("deleteFile", () => {
  it("allows the file's owner to delete it", async () => {
    const file = {
      id: "file-1",
      owner_id: "user-1",
      organization_id: null,
      bucket: "files",
      path: "user-1/file.png",
      filename: "file.png",
      mime_type: "image/png",
      size: 10,
      metadata: {},
      created_at: "now"
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: file, error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const deleteEq = vi.fn().mockResolvedValue({ error: null });

    vi.doMock("@/lib/events", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) })
      })
    }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        storage: { from: () => ({ remove }) },
        from: () => ({ delete: () => ({ eq: deleteEq }) })
      })
    }));

    const { deleteFile } = await import("@/modules/files/files.service");
    await deleteFile(actor, "file-1");

    expect(remove).toHaveBeenCalledWith(["user-1/file.png"]);
    expect(deleteEq).toHaveBeenCalledWith("id", "file-1");
  });

  it("rejects a non-owner with no organization role on the file", async () => {
    const file = {
      id: "file-1",
      owner_id: "someone-else",
      organization_id: null,
      bucket: "files",
      path: "someone-else/file.png",
      filename: "file.png",
      mime_type: "image/png",
      size: 10,
      metadata: {},
      created_at: "now"
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: file, error: null });
    const remove = vi.fn();

    vi.doMock("@/lib/events", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) })
      })
    }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ storage: { from: () => ({ remove }) } })
    }));

    const { deleteFile } = await import("@/modules/files/files.service");

    await expect(deleteFile(actor, "file-1")).rejects.toThrow("not allowed");
    expect(remove).not.toHaveBeenCalled();
  });

  it("allows an org admin to delete another member's org-scoped file", async () => {
    const file = {
      id: "file-1",
      owner_id: "someone-else",
      organization_id: "org-1",
      bucket: "files",
      path: "org-1/file.png",
      filename: "file.png",
      mime_type: "image/png",
      size: 10,
      metadata: {},
      created_at: "now"
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: file, error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const deleteEq = vi.fn().mockResolvedValue({ error: null });

    vi.doMock("@/lib/events", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) })
      })
    }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        storage: { from: () => ({ remove }) },
        from: () => ({ delete: () => ({ eq: deleteEq }) })
      })
    }));
    vi.doMock("@/modules/organizations/organizations.service", () => ({
      getMembership: vi.fn().mockResolvedValue({ role: "admin" })
    }));

    const { deleteFile } = await import("@/modules/files/files.service");
    await deleteFile(actor, "file-1");

    expect(remove).toHaveBeenCalledWith(["org-1/file.png"]);
  });
});
