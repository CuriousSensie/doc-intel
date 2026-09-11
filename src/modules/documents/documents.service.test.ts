import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/lib/supabase/server");
  vi.doUnmock("@/lib/supabase/admin");
  vi.doUnmock("@/lib/queue");
  vi.resetModules();
});

describe("createUploadIntent", () => {
  it("rejects a file over the size limit before touching Supabase", async () => {
    const { createUploadIntent } = await import("@/modules/documents/documents.service");

    await expect(
      createUploadIntent("user-1", "org-1", {
        filename: "huge.pdf",
        size: 200 * 1024 * 1024,
        mimeType: "application/pdf"
      })
    ).rejects.toThrow(/File size/);
  });

  it("rejects a disallowed mime type", async () => {
    const { createUploadIntent } = await import("@/modules/documents/documents.service");

    await expect(
      createUploadIntent("user-1", "org-1", {
        filename: "script.exe",
        size: 1000,
        mimeType: "application/x-msdownload"
      })
    ).rejects.toThrow(/File type is not allowed/);
  });

  it("inserts a pending row, requests a signed URL, and returns it", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "upload-1" }, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    const deleteFn = vi.fn(() => ({ eq: deleteEq }));

    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ from: () => ({ insert, delete: deleteFn }) })
    }));

    const createSignedUploadUrl = vi
      .fn()
      .mockResolvedValue({ data: { signedUrl: "https://x/signed", token: "tok" }, error: null });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ storage: { from: () => ({ createSignedUploadUrl }) } })
    }));

    const { createUploadIntent } = await import("@/modules/documents/documents.service");
    const result = await createUploadIntent("user-1", "org-1", {
      filename: "invoice.pdf",
      size: 1000,
      mimeType: "application/pdf"
    });

    expect(result).toEqual({
      uploadId: "upload-1",
      signedUrl: "https://x/signed",
      token: "tok",
      path: expect.stringContaining("org-1/")
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "org-1",
        created_by: "user-1",
        declared_mime_type: "application/pdf",
        size_bytes: 1000
      })
    );
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it("deletes the row if signed-URL generation fails (compensating cleanup)", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "upload-2" }, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    const deleteFn = vi.fn(() => ({ eq: deleteEq }));

    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ from: () => ({ insert, delete: deleteFn }) })
    }));

    const createSignedUploadUrl = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error("storage down") });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ storage: { from: () => ({ createSignedUploadUrl }) } })
    }));

    const { createUploadIntent } = await import("@/modules/documents/documents.service");
    await expect(
      createUploadIntent("user-1", "org-1", {
        filename: "invoice.pdf",
        size: 1000,
        mimeType: "application/pdf"
      })
    ).rejects.toThrow("storage down");

    expect(deleteFn).toHaveBeenCalled();
    expect(deleteEq).toHaveBeenCalledWith("id", "upload-2");
  });
});

describe("completeUpload", () => {
  function mockUploadRow(overrides: Partial<Record<string, unknown>> = {}) {
    const row = {
      id: "upload-1",
      organization_id: "org-1",
      storage_path: "org-1/abc-invoice.pdf",
      status: "pending",
      created_by: "user-1",
      ...overrides
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    return { select, row };
  }

  it("rejects completing someone else's upload", async () => {
    const { select } = mockUploadRow({ created_by: "someone-else" });
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ from: () => ({ select }) })
    }));

    const { completeUpload } = await import("@/modules/documents/documents.service");
    await expect(completeUpload("user-1", "upload-1")).rejects.toThrow(/your own uploads/);
  });

  it("rejects an upload that isn't pending", async () => {
    const { select } = mockUploadRow({ status: "completed" });
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ from: () => ({ select }) })
    }));

    const { completeUpload } = await import("@/modules/documents/documents.service");
    await expect(completeUpload("user-1", "upload-1")).rejects.toThrow(/not pending/);
  });

  it("rejects when the object never landed in storage", async () => {
    const { select } = mockUploadRow();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ from: () => ({ select }) })
    }));

    const list = vi.fn().mockResolvedValue({ data: [], error: null });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ storage: { from: () => ({ list }) } })
    }));

    const { completeUpload } = await import("@/modules/documents/documents.service");
    await expect(completeUpload("user-1", "upload-1")).rejects.toThrow(/was not found in storage/);
  });

  it("marks the row uploaded and enqueues validate-upload when the object exists", async () => {
    const { select } = mockUploadRow();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ from: () => ({ select }) })
    }));

    const list = vi.fn().mockResolvedValue({ data: [{ name: "abc-invoice.pdf" }], error: null });
    const updateSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: "upload-1", status: "uploaded" }, error: null });
    const updateSelect = vi.fn(() => ({ single: updateSingle }));
    const updateEq = vi.fn(() => ({ select: updateSelect }));
    const update = vi.fn(() => ({ eq: updateEq }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        storage: { from: () => ({ list }) },
        from: () => ({ update })
      })
    }));

    const enqueue = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/queue", () => ({
      enqueue,
      QUEUE_NAMES: { validateUpload: "validate-upload" }
    }));

    const { completeUpload } = await import("@/modules/documents/documents.service");
    const result = await completeUpload("user-1", "upload-1");

    expect(result.status).toBe("uploaded");
    expect(update).toHaveBeenCalledWith({ status: "uploaded" });
    expect(enqueue).toHaveBeenCalledWith("validate-upload", {
      orgId: "org-1",
      uploadId: "upload-1"
    });
  });
});
