import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/lib/supabase/server");
  vi.doUnmock("@/lib/supabase/admin");
  vi.doUnmock("@/lib/queue");
  vi.doUnmock("@/lib/events");
  vi.doUnmock("@/lib/paperless/client");
  vi.doUnmock("@/lib/paperless/documents");
  vi.doUnmock("@/lib/redis");
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
      QUEUE_NAMES: { ingestDocument: "ingest-document" }
    }));

    const { completeUpload } = await import("@/modules/documents/documents.service");
    const result = await completeUpload("user-1", "upload-1");

    expect(result.status).toBe("uploaded");
    expect(update).toHaveBeenCalledWith({ status: "uploaded" });
    expect(enqueue).toHaveBeenCalledWith("ingest-document", {
      orgId: "org-1",
      uploadId: "upload-1"
    });
  });
});

describe("getDocument", () => {
  const DOC_ROW = {
    id: "doc-1",
    organization_id: "org-1",
    paperless_document_id: 42,
    title: "Invoice"
  };

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
  const DOC_ROW = {
    id: "doc-1",
    organization_id: "org-1",
    paperless_document_id: 42,
    title: "Old title"
  };

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

  it("patches tags without touching the mirror row (tags aren't mirrored)", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => makeQueryClient({ documents: [{ data: DOC_ROW, error: null }] })
    }));
    vi.doMock("@/modules/organizations/organizations.service", () => ({
      getMembership: vi.fn().mockResolvedValue({ role: "member" })
    }));
    vi.doMock("@/lib/paperless/client", () => ({
      paperlessFor: vi.fn().mockResolvedValue({})
    }));
    const updatePaperlessDocument = vi.fn().mockResolvedValue({ tags: [1, 2] });
    vi.doMock("@/lib/paperless/documents", () => ({ updatePaperlessDocument }));
    const adminFrom = vi.fn();
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: adminFrom }) }));
    vi.doMock("@/lib/events", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));

    const { updateDocument } = await import("@/modules/documents/documents.service");
    const result = await updateDocument("user-1", "org-1", "doc-1", { tagIds: [1, 2] });

    expect(updatePaperlessDocument).toHaveBeenCalledWith({}, 42, { tags: [1, 2] });
    expect(adminFrom).not.toHaveBeenCalled();
    expect(result).toEqual(DOC_ROW);
  });

  it("patches correspondent and mirrors the resolved name back", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => makeQueryClient({ documents: [{ data: DOC_ROW, error: null }] })
    }));
    vi.doMock("@/modules/organizations/organizations.service", () => ({
      getMembership: vi.fn().mockResolvedValue({ role: "member" })
    }));
    vi.doMock("@/lib/paperless/client", () => ({
      paperlessFor: vi.fn().mockResolvedValue({})
    }));
    const updatePaperlessDocument = vi.fn().mockResolvedValue({ correspondent: 7 });
    const getPaperlessCorrespondentName = vi.fn().mockResolvedValue("Acme Corp");
    vi.doMock("@/lib/paperless/documents", () => ({
      updatePaperlessDocument,
      getPaperlessCorrespondentName
    }));

    let mirrorUpdatePayload: unknown;
    let provenanceUpsertPayload: unknown;
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: (table: string) => {
          if (table === "field_provenance") {
            return {
              upsert: (payload: unknown) => {
                provenanceUpsertPayload = payload;
                return Promise.resolve({ error: null });
              }
            };
          }
          return {
            update: (payload: unknown) => {
              mirrorUpdatePayload = payload;
              return {
                eq: () => ({
                  eq: () => ({
                    select: () => ({
                      single: () =>
                        Promise.resolve({
                          data: { ...DOC_ROW, correspondent_name: "Acme Corp" },
                          error: null
                        })
                    })
                  })
                })
              };
            }
          };
        }
      })
    }));
    vi.doMock("@/lib/events", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));

    const { updateDocument } = await import("@/modules/documents/documents.service");
    const result = await updateDocument("user-1", "org-1", "doc-1", { correspondentId: 7 });

    expect(updatePaperlessDocument).toHaveBeenCalledWith({}, 42, { correspondent: 7 });
    expect(getPaperlessCorrespondentName).toHaveBeenCalledWith({}, 7);
    expect(mirrorUpdatePayload).toEqual({ correspondent_name: "Acme Corp" });
    expect(result.correspondent_name).toBe("Acme Corp");
    // specs/07-rules-engine.md "user edits win over rules always" — a human editing a field
    // through this app marks it in field_provenance, so a later rule run never overwrites it.
    expect(provenanceUpsertPayload).toEqual([
      expect.objectContaining({
        organization_id: "org-1",
        document_id: "doc-1",
        field_key: "document.correspondent",
        updated_by: "user",
        source_id: "user-1"
      })
    ]);
  });
});

describe("deleteDocument", () => {
  const DOC_ROW = {
    id: "doc-1",
    organization_id: "org-1",
    paperless_document_id: 42,
    title: "Invoice"
  };

  it("rejects a read-only member before touching Paperless", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => makeQueryClient({ documents: [{ data: DOC_ROW, error: null }] })
    }));
    vi.doMock("@/modules/organizations/organizations.service", () => ({
      getMembership: vi.fn().mockResolvedValue({ role: "read-only" })
    }));
    const paperlessFor = vi.fn();
    vi.doMock("@/lib/paperless/client", () => ({ paperlessFor }));

    const { deleteDocument } = await import("@/modules/documents/documents.service");
    await expect(deleteDocument("user-1", "org-1", "doc-1")).rejects.toThrow(/write access/);
    expect(paperlessFor).not.toHaveBeenCalled();
  });

  it("deletes in Paperless, soft-deletes the mirror row, and logs the event", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => makeQueryClient({ documents: [{ data: DOC_ROW, error: null }] })
    }));
    vi.doMock("@/modules/organizations/organizations.service", () => ({
      getMembership: vi.fn().mockResolvedValue({ role: "member" })
    }));
    vi.doMock("@/lib/paperless/client", () => ({
      paperlessFor: vi.fn().mockResolvedValue({})
    }));
    const deletePaperlessDocument = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/paperless/documents", () => ({ deletePaperlessDocument }));

    let mirrorUpdatePayload: unknown;
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          update: (payload: unknown) => {
            mirrorUpdatePayload = payload;
            return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
          }
        })
      })
    }));
    const logEvent = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/events", () => ({ logEvent }));

    const { deleteDocument } = await import("@/modules/documents/documents.service");
    await deleteDocument("user-1", "org-1", "doc-1");

    expect(deletePaperlessDocument).toHaveBeenCalledWith({}, 42);
    expect(mirrorUpdatePayload).toHaveProperty("deleted_at");
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "document.deleted", entityId: "doc-1" })
    );
  });
});

describe("getAdjacentDocumentId", () => {
  const CURRENT = {
    id: "doc-current",
    title: "M",
    created_at: "2026-06-01T00:00:00Z"
  } as unknown as Parameters<typeof import("./documents.service").getAdjacentDocumentId>[1];

  it("queries ascending for 'previous' against a default (descending) list", async () => {
    const order = vi.fn();
    function chain(): Record<string, unknown> {
      const proxy: Record<string, unknown> = {
        select: () => proxy,
        eq: () => proxy,
        is: () => proxy,
        in: () => proxy,
        or: () => proxy,
        order: (...args: unknown[]) => {
          order(...args);
          return proxy;
        },
        limit: () =>
          Promise.resolve({
            data: [{ id: "doc-prev", created_at: "2026-05-01T00:00:00Z" }],
            error: null
          })
      };
      return proxy;
    }
    const from = vi.fn(() => chain());
    vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }));

    const { getAdjacentDocumentId } = await import("@/modules/documents/documents.service");
    const result = await getAdjacentDocumentId("org-1", CURRENT, {}, "previous");

    expect(order).toHaveBeenNthCalledWith(1, "created_at", { ascending: true });
    expect(result).toBe("doc-prev");
  });

  it("returns null when there is no adjacent document", async () => {
    function chain(): Record<string, unknown> {
      const proxy: Record<string, unknown> = {
        select: () => proxy,
        eq: () => proxy,
        is: () => proxy,
        in: () => proxy,
        or: () => proxy,
        order: () => proxy,
        limit: () => Promise.resolve({ data: [], error: null })
      };
      return proxy;
    }
    const from = vi.fn(() => chain());
    vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }));

    const { getAdjacentDocumentId } = await import("@/modules/documents/documents.service");
    const result = await getAdjacentDocumentId("org-1", CURRENT, {}, "next");

    expect(result).toBeNull();
  });
});

describe("listDocuments — hasNoConnections", () => {
  function makeRow(id: string) {
    return {
      id,
      organization_id: "org-1",
      paperless_document_id: 1,
      title: "Invoice",
      created_at: "2026-01-01T00:00:00Z"
    };
  }

  it("dispatches to the paginated no-connections RPCs instead of building a NOT IN list", async () => {
    const rpc = vi.fn((name: string) => {
      if (name === "list_documents_without_connections_page") {
        return Promise.resolve({ data: [makeRow("doc-1")], error: null });
      }
      if (name === "count_documents_without_connections") {
        return Promise.resolve({ data: 1, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const from = vi.fn(() => {
      throw new Error("hasNoConnections must not touch documents/connections via .from()");
    });
    vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => ({ from, rpc }) }));

    const { listDocuments } = await import("@/modules/documents/documents.service");
    const result = await listDocuments("org-1", { hasNoConnections: true, status: "ready" });

    expect(rpc).toHaveBeenCalledWith(
      "list_documents_without_connections_page",
      expect.objectContaining({ p_organization_id: "org-1", p_status: "ready", p_limit: 25 })
    );
    expect(rpc).toHaveBeenCalledWith(
      "count_documents_without_connections",
      expect.objectContaining({ p_organization_id: "org-1", p_status: "ready" })
    );
    expect(result.items).toHaveLength(1);
    expect(result.totalCount).toBe(1);
  });

  it("short-circuits to empty when hasNoConnections and entityId are both set (contradictory)", async () => {
    const from = vi.fn(() => {
      throw new Error("a contradictory filter must never reach a query");
    });
    vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }));

    const { listDocuments } = await import("@/modules/documents/documents.service");
    const result = await listDocuments("org-1", { hasNoConnections: true, entityId: "entity-1" });

    expect(result).toMatchObject({ items: [], nextCursor: null, totalCount: 0 });
  });
});

describe("listDocuments — sort", () => {
  function makeRow(id: string, title: string) {
    return {
      id,
      organization_id: "org-1",
      paperless_document_id: 1,
      title,
      document_type_key: "invoice",
      created_at: "2026-01-01T00:00:00Z"
    };
  }

  it("defaults to created_at descending when no sort is given", async () => {
    const order = vi.fn(() => chain());
    function chain(): Record<string, unknown> {
      const proxy: Record<string, unknown> = {
        select: () => proxy,
        eq: () => proxy,
        is: () => proxy,
        in: () => proxy,
        or: () => proxy,
        order,
        limit: () => Promise.resolve({ data: [makeRow("doc-1", "A")], error: null }),
        range: () => Promise.resolve({ data: [makeRow("doc-1", "A")], error: null, count: 1 })
      };
      return proxy;
    }
    order.mockImplementation(() => chain());
    const from = vi.fn(() => chain());
    vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }));

    const { listDocuments } = await import("@/modules/documents/documents.service");
    await listDocuments("org-1", {});

    expect(order).toHaveBeenNthCalledWith(1, "created_at", { ascending: false });
    expect(order).toHaveBeenNthCalledWith(2, "id", { ascending: false });
  });

  it("sorts by title ascending when requested, with id as the tiebreaker in the same direction", async () => {
    const order = vi.fn();
    function chain(): Record<string, unknown> {
      const proxy: Record<string, unknown> = {
        select: () => proxy,
        eq: () => proxy,
        is: () => proxy,
        in: () => proxy,
        or: () => proxy,
        order: (...args: unknown[]) => {
          order(...args);
          return proxy;
        },
        limit: () => Promise.resolve({ data: [makeRow("doc-1", "A")], error: null }),
        range: () => Promise.resolve({ data: [makeRow("doc-1", "A")], error: null, count: 1 })
      };
      return proxy;
    }
    const from = vi.fn(() => chain());
    vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }));

    const { listDocuments } = await import("@/modules/documents/documents.service");
    await listDocuments("org-1", { sort: "title", sortDirection: "asc" });

    expect(order).toHaveBeenNthCalledWith(1, "title", { ascending: true });
    expect(order).toHaveBeenNthCalledWith(2, "id", { ascending: true });
  });
});

describe("resolvePaperlessIdFilter (via listDocumentIds)", () => {
  it("combines q/titleOnly/tagIds/correspondentId into a single Paperless request", async () => {
    const get = vi.fn().mockResolvedValue({ results: [{ id: 1 }] });
    vi.doMock("@/lib/paperless/client", () => ({ paperlessFor: async () => ({ get }) }));
    vi.doMock("@/lib/redis", () => ({
      getRedisClient: () => ({ get: vi.fn().mockResolvedValue(null), set: vi.fn() })
    }));

    function chain(): Record<string, unknown> {
      const proxy: Record<string, unknown> = {
        select: () => proxy,
        eq: () => proxy,
        is: () => proxy,
        in: () => proxy,
        or: () => proxy,
        order: () => proxy,
        limit: () => Promise.resolve({ data: [], error: null })
      };
      return proxy;
    }
    const from = vi.fn(() => chain());
    vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }));

    const { listDocumentIds } = await import("@/modules/documents/documents.service");
    await listDocumentIds("org-1", {
      q: "invoice",
      titleOnly: true,
      tagIds: [1, 2],
      correspondentId: 9
    });

    expect(get).toHaveBeenCalledTimes(1);
    const url = get.mock.calls[0][0] as string;
    expect(url).toContain("title__icontains=invoice");
    expect(url).toContain("tags__id__in=1%2C2");
    expect(url).toContain("correspondent__id__in=9");
    expect(url).not.toContain("query=");
  });
});

describe("listDocumentIds", () => {
  it("resolves the q/tag Paperless search once across multiple pages, not once per page", async () => {
    const get = vi.fn().mockResolvedValue({ results: [{ id: 1 }, { id: 2 }] });
    vi.doMock("@/lib/paperless/client", () => ({ paperlessFor: async () => ({ get }) }));
    vi.doMock("@/lib/redis", () => ({
      getRedisClient: () => ({ get: vi.fn().mockResolvedValue(null), set: vi.fn() })
    }));

    let page = 0;
    function chain(): Record<string, unknown> {
      const proxy: Record<string, unknown> = {
        select: () => proxy,
        eq: () => proxy,
        is: () => proxy,
        in: () => proxy,
        or: () => proxy,
        order: () => proxy,
        limit: (n: number) => {
          page++;
          // Page 1: exactly n rows (limit+1) so hasMore is true and a second page is fetched.
          // Page 2: nothing left. The Paperless search above must only ever run once regardless.
          if (page === 1) {
            const rows = Array.from({ length: n }, (_, i) => ({
              id: `doc-${i}`,
              organization_id: "org-1",
              paperless_document_id: 1,
              title: "Invoice",
              created_at: `2026-01-01T00:00:0${i % 9}Z`
            }));
            return Promise.resolve({ data: rows, error: null });
          }
          return Promise.resolve({ data: [], error: null });
        }
      };
      return proxy;
    }
    const from = vi.fn(() => chain());
    vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }));

    const { listDocumentIds } = await import("@/modules/documents/documents.service");
    const ids = await listDocumentIds("org-1", { q: "invoice" });

    expect(page).toBeGreaterThan(1);
    expect(get).toHaveBeenCalledTimes(1);
    expect(ids.length).toBeGreaterThan(0);
  });
});
