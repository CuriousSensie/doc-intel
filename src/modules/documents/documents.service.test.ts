import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/lib/supabase/server");
  vi.doUnmock("@/lib/supabase/admin");
  vi.doUnmock("@/lib/queue");
  vi.doUnmock("@/lib/events");
  vi.doUnmock("@/lib/paperless/client");
  vi.doUnmock("@/lib/paperless/documents");
  vi.doUnmock("@/modules/connections/connections.service");
  vi.doUnmock("@/modules/organizations/organizations.service");
  vi.resetModules();
});

// Chainable + thenable fake, same shape used across the entities/connections test suites —
// every method returns itself, and awaiting at any point resolves to the configured result.
function makeChain(result: unknown) {
  const target: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(target, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
          Promise.resolve(result).then(resolve, reject);
      }
      if (prop === "maybeSingle" || prop === "single") {
        return () => Promise.resolve(result);
      }
      return () => proxy;
    }
  });
  return proxy;
}

function makeQueryClient(responses: Record<string, unknown[]>) {
  const counters: Record<string, number> = {};
  return {
    from: (table: string) => {
      const idx = counters[table] ?? 0;
      counters[table] = idx + 1;
      const queued = responses[table];
      return makeChain(queued?.[idx] ?? { data: null, error: null });
    }
  };
}

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

describe("getDocument", () => {
  const DOC_ROW = { id: "doc-1", organization_id: "org-1", paperless_document_id: 42, title: "Invoice" };

  it("returns the mirror row with connections and Paperless custom fields", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => makeQueryClient({ documents: [{ data: DOC_ROW, error: null }] })
    }));
    vi.doMock("@/modules/connections/connections.service", () => ({
      getConnections: vi.fn().mockResolvedValue([{ id: "conn-1" }])
    }));
    vi.doMock("@/lib/paperless/client", () => ({
      paperlessFor: vi.fn().mockResolvedValue({})
    }));
    vi.doMock("@/lib/paperless/documents", () => ({
      getPaperlessDocument: vi.fn().mockResolvedValue({ custom_fields: [{ field: 1, value: "x" }] })
    }));

    const { getDocument } = await import("@/modules/documents/documents.service");
    const result = await getDocument("doc-1");

    expect(result.connections).toEqual([{ id: "conn-1" }]);
    expect(result.paperless).toEqual({ customFields: [{ field: 1, value: "x" }] });
  });

  it("degrades to paperless: null when Paperless is unreachable, without failing the page", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => makeQueryClient({ documents: [{ data: DOC_ROW, error: null }] })
    }));
    vi.doMock("@/modules/connections/connections.service", () => ({
      getConnections: vi.fn().mockResolvedValue([])
    }));
    vi.doMock("@/lib/paperless/client", () => ({
      paperlessFor: vi.fn().mockRejectedValue(new Error("unreachable"))
    }));

    const { getDocument } = await import("@/modules/documents/documents.service");
    const result = await getDocument("doc-1");

    expect(result.paperless).toBeNull();
  });

  it("throws NotFoundError for a wrong-org or missing document id", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => makeQueryClient({ documents: [{ data: null, error: null }] })
    }));

    const { getDocument } = await import("@/modules/documents/documents.service");
    await expect(getDocument("doc-missing")).rejects.toThrow(/not found/i);
  });
});

describe("updateDocument", () => {
  const DOC_ROW = { id: "doc-1", organization_id: "org-1", paperless_document_id: 42, title: "Old title" };

  it("rejects a read-only member before touching Paperless", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => makeQueryClient({ documents: [{ data: DOC_ROW, error: null }] })
    }));
    vi.doMock("@/modules/organizations/organizations.service", () => ({
      getMembership: vi.fn().mockResolvedValue({ role: "read-only" })
    }));
    const paperlessFor = vi.fn();
    vi.doMock("@/lib/paperless/client", () => ({ paperlessFor }));

    const { updateDocument } = await import("@/modules/documents/documents.service");
    await expect(
      updateDocument("user-1", "org-1", "doc-1", { title: "New title" })
    ).rejects.toThrow(/write access/);

    expect(paperlessFor).not.toHaveBeenCalled();
  });

  it("writes the title through to Paperless, then mirrors Paperless's own response", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => makeQueryClient({ documents: [{ data: DOC_ROW, error: null }] })
    }));
    vi.doMock("@/modules/organizations/organizations.service", () => ({
      getMembership: vi.fn().mockResolvedValue({ role: "member" })
    }));
    vi.doMock("@/lib/paperless/client", () => ({
      paperlessFor: vi.fn().mockResolvedValue({})
    }));
    const updatePaperlessDocument = vi.fn().mockResolvedValue({ title: "New title" });
    vi.doMock("@/lib/paperless/documents", () => ({ updatePaperlessDocument }));

    let mirrorUpdatePayload: unknown;
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          update: (payload: unknown) => {
            mirrorUpdatePayload = payload;
            return {
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    single: () =>
                      Promise.resolve({ data: { ...DOC_ROW, title: "New title" }, error: null })
                  })
                })
              })
            };
          }
        })
      })
    }));
    vi.doMock("@/lib/events", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));

    const { updateDocument } = await import("@/modules/documents/documents.service");
    const result = await updateDocument("user-1", "org-1", "doc-1", { title: "New title" });

    expect(updatePaperlessDocument).toHaveBeenCalledWith({}, 42, { title: "New title" });
    expect(mirrorUpdatePayload).toEqual({ title: "New title" });
    expect(result.title).toBe("New title");
  });
});
