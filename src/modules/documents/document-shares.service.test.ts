import { afterEach, describe, expect, it, vi } from "vitest";

import type { ServiceContext } from "@/lib/service-context";

afterEach(() => {
  vi.doUnmock("@/lib/supabase/server");
  vi.resetModules();
});

function makeDb(rpc: ReturnType<typeof vi.fn>): ServiceContext["db"] {
  return { rpc } as unknown as ServiceContext["db"];
}

describe("shareDocument", () => {
  it("calls share_document with the document, recipient and permission", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const { shareDocument } = await import("@/modules/documents/document-shares.service");

    await shareDocument(makeDb(rpc), { documentId: "doc-1", userId: "user-2", permission: "edit" });

    expect(rpc).toHaveBeenCalledWith("share_document", {
      p_document_id: "doc-1",
      p_user_id: "user-2",
      p_permission: "edit"
    });
  });

  it("passes a null recipient through as an organization-wide share", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const { shareDocument } = await import("@/modules/documents/document-shares.service");

    await shareDocument(makeDb(rpc), { documentId: "doc-1", userId: null, permission: "view" });

    expect(rpc).toHaveBeenCalledWith("share_document", {
      p_document_id: "doc-1",
      p_user_id: null,
      p_permission: "view"
    });
  });

  it("turns a Postgres raise-exception into a user-facing validation error", async () => {
    const rpc = vi.fn().mockResolvedValue({
      error: { code: "P0001", message: "Read-only members cannot be given edit access" }
    });
    const { shareDocument } = await import("@/modules/documents/document-shares.service");

    await expect(
      shareDocument(makeDb(rpc), { documentId: "doc-1", userId: "user-2", permission: "edit" })
    ).rejects.toMatchObject({ code: "validation_error", message: /Read-only members/ });
  });

  it("rethrows unexpected database errors untouched", async () => {
    const dbError = { code: "XX000", message: "boom" };
    const rpc = vi.fn().mockResolvedValue({ error: dbError });
    const { unshareDocument } = await import("@/modules/documents/document-shares.service");

    await expect(
      unshareDocument(makeDb(rpc), { documentId: "doc-1", userId: "user-2" })
    ).rejects.toBe(dbError);
  });
});

describe("getDocumentPermissions", () => {
  it("returns the single get_document_permissions payload as-is", async () => {
    const payload = {
      owner: { name: "Olga", email: "o@x.si" },
      createdBy: null,
      canManage: true,
      currentUserId: "user-1",
      shares: [],
      members: []
    };
    const rpc = vi.fn().mockResolvedValue({ data: payload, error: null });
    const { getDocumentPermissions } = await import("@/modules/documents/document-shares.service");

    await expect(getDocumentPermissions(makeDb(rpc), "doc-1")).resolves.toEqual(payload);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_document_permissions", { p_document_id: "doc-1" });
  });

  it("maps 'document not visible to the caller' to a not-found error", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: "P0002", message: "Document not found" } });
    const { getDocumentPermissions } = await import("@/modules/documents/document-shares.service");

    await expect(getDocumentPermissions(makeDb(rpc), "doc-1")).rejects.toMatchObject({
      code: "not_found"
    });
  });
});

describe("loadDocumentPermissions", () => {
  it("never rejects — a failure becomes an error result the tab can render", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } })
      })
    }));
    const { loadDocumentPermissions } = await import("@/modules/documents/document-shares.service");

    await expect(loadDocumentPermissions("doc-1")).resolves.toEqual({ ok: false, message: "boom" });
  });
});
