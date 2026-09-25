import { describe, expect, it, vi } from "vitest";

import type { ServiceContext } from "@/lib/service-context";

// documents has no UPDATE policy, so moveDocumentToFolder/moveDocumentsToFolder write through the
// admin client (see the service comments) — mocked here so those paths don't need real env keys.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from "@/lib/supabase/admin";

function makeCtx(overrides: Partial<ServiceContext["db"]> = {}): ServiceContext {
  const db = { rpc: vi.fn(), from: vi.fn(), ...overrides } as unknown as ServiceContext["db"];
  return { db, orgId: "org-1", actorId: "user-1", correlationId: "corr-1" };
}

describe("createFolder", () => {
  it("calls create_folder with the parent, name and match conditions", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "folder-1", error: null });
    const ctx = makeCtx({ rpc });
    const { createFolder } = await import("./folders.service");

    const id = await createFolder(ctx, { parentFolderId: "parent-1", name: "2025", matchConditions: null });

    expect(id).toBe("folder-1");
    expect(rpc).toHaveBeenCalledWith("create_folder", {
      p_organization_id: "org-1",
      p_parent_folder_id: "parent-1",
      p_name: "2025",
      p_match_conditions: null
    });
  });

  it("turns a Postgres raise-exception into a user-facing validation error", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { code: "P0001", message: "Parent folder not found" } });
    const ctx = makeCtx({ rpc });
    const { createFolder } = await import("./folders.service");

    await expect(
      createFolder(ctx, { parentFolderId: "missing", name: "x", matchConditions: null })
    ).rejects.toMatchObject({ code: "validation_error", message: /Parent folder not found/ });
  });

  it("rethrows unexpected database errors untouched", async () => {
    const dbError = { code: "XX000", message: "boom" };
    const rpc = vi.fn().mockResolvedValue({ error: dbError });
    const ctx = makeCtx({ rpc });
    const { createFolder } = await import("./folders.service");

    await expect(
      createFolder(ctx, { parentFolderId: null, name: "x", matchConditions: null })
    ).rejects.toBe(dbError);
  });
});

describe("moveFolder", () => {
  it("calls move_folder with the folder and destination", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const ctx = makeCtx({ rpc });
    const { moveFolder } = await import("./folders.service");

    await moveFolder(ctx, "folder-1", "folder-2");

    expect(rpc).toHaveBeenCalledWith("move_folder", {
      p_folder_id: "folder-1",
      p_new_parent_folder_id: "folder-2"
    });
  });

  it("surfaces a cycle-prevention error as a validation error", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ error: { code: "P0001", message: "A folder cannot be moved into one of its own subfolders" } });
    const ctx = makeCtx({ rpc });
    const { moveFolder } = await import("./folders.service");

    await expect(moveFolder(ctx, "folder-1", "folder-1-child")).rejects.toMatchObject({
      code: "validation_error",
      message: /own subfolders/
    });
  });
});

describe("grantFolderAccess / revokeFolderAccess", () => {
  it("calls grant_folder_access with the folder, recipient and permission", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const ctx = makeCtx({ rpc });
    const { grantFolderAccess } = await import("./folders.service");

    await grantFolderAccess(ctx, "folder-1", "user-2", "edit");

    expect(rpc).toHaveBeenCalledWith("grant_folder_access", {
      p_folder_id: "folder-1",
      p_user_id: "user-2",
      p_permission: "edit"
    });
  });

  it("calls revoke_folder_access with the folder and recipient", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const ctx = makeCtx({ rpc });
    const { revokeFolderAccess } = await import("./folders.service");

    await revokeFolderAccess(ctx, "folder-1", "user-2");

    expect(rpc).toHaveBeenCalledWith("revoke_folder_access", { p_folder_id: "folder-1", p_user_id: "user-2" });
  });
});

describe("updateFolderMatchConditions", () => {
  it("calls the SECURITY DEFINER RPC with the pattern", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const ctx = makeCtx({ rpc });
    const { updateFolderMatchConditions } = await import("./folders.service");
    const pattern = { field: "document.filename", op: "contains", value: "invoice" } as const;

    await updateFolderMatchConditions(ctx, "folder-1", pattern);

    expect(rpc).toHaveBeenCalledWith("update_folder_match_conditions", {
      p_folder_id: "folder-1",
      p_match_conditions: pattern
    });
  });

  it("clears the pattern with null", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const ctx = makeCtx({ rpc });
    const { updateFolderMatchConditions } = await import("./folders.service");

    await updateFolderMatchConditions(ctx, "folder-1", null);

    expect(rpc).toHaveBeenCalledWith("update_folder_match_conditions", {
      p_folder_id: "folder-1",
      p_match_conditions: null
    });
  });

  it("turns a raise-exception into a user-facing validation error", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ error: { code: "P0001", message: "You do not have access to edit this folder's matching pattern" } });
    const ctx = makeCtx({ rpc });
    const { updateFolderMatchConditions } = await import("./folders.service");

    await expect(updateFolderMatchConditions(ctx, "folder-1", null)).rejects.toMatchObject({
      code: "validation_error"
    });
  });
});

describe("moveDocumentToFolder", () => {
  it("requires edit access to both the document and the destination folder, then writes via admin", async () => {
    const rpc = vi.fn((fn: string) => {
      if (fn === "can_edit_document") return Promise.resolve({ data: true, error: null });
      if (fn === "can_access_folder") return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const eq = vi.fn();
    eq.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const update = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ update });
    vi.mocked(createAdminClient).mockReturnValue({ from } as never);
    const ctx = makeCtx({ rpc } as never);
    const { moveDocumentToFolder } = await import("./folders.service");

    await moveDocumentToFolder(ctx, "doc-1", "folder-1");

    expect(rpc).toHaveBeenCalledWith("can_edit_document", { p_document_id: "doc-1" });
    expect(rpc).toHaveBeenCalledWith("can_access_folder", { p_folder_id: "folder-1", p_require: "edit" });
    expect(update).toHaveBeenCalledWith({ folder_id: "folder-1" });
  });

  it("rejects without touching the database when the caller cannot edit the document", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    vi.mocked(createAdminClient).mockClear();
    const ctx = makeCtx({ rpc } as never);
    const { moveDocumentToFolder } = await import("./folders.service");

    await expect(moveDocumentToFolder(ctx, "doc-1", "folder-1")).rejects.toMatchObject({
      code: "authorization_error"
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

// Mocks listFolderTree()'s query chain (`.select().eq().is().order().order()`) — folder rows come
// from `getRows()` so a test can simulate a fresh read returning newly-created rows (the
// concurrent-create-race fallback path).
function makeFoldersTable(getRows: () => unknown[]) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => ({
    order: vi.fn(() => ({
      order: vi.fn(() => Promise.resolve({ data: getRows(), error: null }))
    }))
  }));
  return chain;
}

// listFolderTree() also reads the caller's own folder_access grants and org role once a
// non-empty folder list makes it past the early-return — these two are always empty/non-admin
// for these tests, which only care about the create/reuse/race behavior, not accessLevel.
function makeSideTablesFrom(getRows: () => unknown[]) {
  return vi.fn((table: string) => {
    if (table === "folders") return makeFoldersTable(getRows);
    if (table === "folder_access") {
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: [], error: null }) };
    }
    if (table === "organization_members") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
      };
    }
    return undefined;
  });
}

// get_folder_document_counts is the other new listFolderTree() dependency — routed separately so
// a test's own create_folder mock doesn't have to also know about it.
function withFolderCountsRpc(rpc: ReturnType<typeof vi.fn>) {
  return vi.fn((fn: string, args: unknown) => {
    if (fn === "get_folder_document_counts") return Promise.resolve({ data: [], error: null });
    return rpc(fn, args);
  });
}

describe("resolveOrCreateFolderPaths", () => {
  it("returns an empty map without touching the database for an empty input", async () => {
    const from = vi.fn();
    const ctx = makeCtx({ from } as never);
    const { resolveOrCreateFolderPaths } = await import("./folders.service");

    expect(await resolveOrCreateFolderPaths(ctx, [])).toEqual({});
    expect(from).not.toHaveBeenCalled();
  });

  it("creates each missing segment once and reuses it across sibling paths", async () => {
    let rows: unknown[] = [];
    const from = vi.fn((table: string) => (table === "folders" ? makeFoldersTable(() => rows) : undefined));
    let nextId = 0;
    const rpc = vi.fn((_fn: string, args: { p_parent_folder_id: string | null; p_name: string }) => {
      const id = `folder-${++nextId}`;
      rows = [
        ...rows,
        { id, parent_folder_id: args.p_parent_folder_id, name: args.p_name, path: "", depth: 0, match_conditions: null, created_by: null, created_at: "" }
      ];
      return Promise.resolve({ data: id, error: null });
    });
    const ctx = makeCtx({ from, rpc } as never);
    const { resolveOrCreateFolderPaths } = await import("./folders.service");

    const result = await resolveOrCreateFolderPaths(ctx, ["Invoices/2025", "Invoices/2026"]);

    // "Invoices" created exactly once and reused as the parent for both "2025" and "2026".
    expect(rpc).toHaveBeenCalledTimes(3);
    const invoicesCreateCalls = rpc.mock.calls.filter((call) => call[1].p_name === "Invoices");
    expect(invoicesCreateCalls).toHaveLength(1);
    const call2025 = rpc.mock.calls.find((call) => call[1].p_name === "2025")!;
    const call2026 = rpc.mock.calls.find((call) => call[1].p_name === "2026")!;
    expect(call2025[1].p_parent_folder_id).toBe(call2026[1].p_parent_folder_id);
    expect(Object.keys(result)).toEqual(["Invoices/2025", "Invoices/2026"]);
    expect(result["Invoices/2025"]).not.toBe(result["Invoices/2026"]);
  });

  it("reuses an already-existing folder instead of recreating it", async () => {
    const rows = [
      {
        id: "existing-invoices",
        parent_folder_id: null,
        name: "Invoices",
        path: "/Invoices",
        depth: 0,
        match_conditions: null,
        created_by: null,
        created_at: ""
      }
    ];
    const from = makeSideTablesFrom(() => rows);
    const rpc = vi.fn().mockResolvedValue({ data: "new-2025", error: null });
    const ctx = makeCtx({ from, rpc: withFolderCountsRpc(rpc) } as never);
    const { resolveOrCreateFolderPaths } = await import("./folders.service");

    const result = await resolveOrCreateFolderPaths(ctx, ["Invoices/2025"]);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "create_folder",
      expect.objectContaining({ p_parent_folder_id: "existing-invoices", p_name: "2025" })
    );
    expect(result["Invoices/2025"]).toBe("new-2025");
  });

  it("resolves a lost create race by re-reading instead of failing the batch", async () => {
    let rows: unknown[] = [];
    const from = makeSideTablesFrom(() => rows);
    const rpc = vi.fn().mockResolvedValueOnce({
      error: { code: "P0001", message: "duplicate folder name" }
    });
    const ctx = makeCtx({ from, rpc: withFolderCountsRpc(rpc) } as never);
    const { resolveOrCreateFolderPaths } = await import("./folders.service");

    // Simulate a concurrent caller's create landing between the initial listFolderTree() read
    // (empty) and this call's own create_folder attempt (which loses the race and throws).
    rows = [
      {
        id: "winner-id",
        parent_folder_id: null,
        name: "Invoices",
        path: "/Invoices",
        depth: 0,
        match_conditions: null,
        created_by: null,
        created_at: ""
      }
    ];

    const result = await resolveOrCreateFolderPaths(ctx, ["Invoices"]);

    expect(result.Invoices).toBe("winner-id");
  });
});

describe("listFolderTree — accessLevel/counts", () => {
  const invoices = {
    id: "invoices",
    parent_folder_id: null,
    name: "Invoices",
    path: "/Invoices",
    depth: 0,
    match_conditions: null,
    created_by: "someone-else",
    created_at: ""
  };
  const sept = {
    id: "sept",
    parent_folder_id: "invoices",
    name: "Sept",
    path: "/Invoices/Sept",
    depth: 1,
    match_conditions: null,
    created_by: "someone-else",
    created_at: ""
  };

  it("marks a folder 'full' only via a direct grant on it or an ancestor, 'ancestor' otherwise", async () => {
    const from = vi.fn((table: string) => {
      if (table === "folders") return makeFoldersTable(() => [invoices, sept]);
      if (table === "folder_access") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [{ folder_id: "sept" }], error: null })
        };
      }
      if (table === "organization_members") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { role: "member" }, error: null })
        };
      }
      return undefined;
    });
    const rpc = vi.fn().mockResolvedValue({
      data: [{ folder_id: "sept", document_count: 3 }],
      error: null
    });
    const ctx = makeCtx({ from, rpc } as never);
    const { listFolderTree } = await import("./folders.service");

    const result = await listFolderTree(ctx);
    const byId = new Map(result.map((f) => [f.id, f]));

    // "Sept" has a direct grant — full access, its own document count surfaced.
    expect(byId.get("sept")).toMatchObject({ accessLevel: "full", documentCount: 3, childFolderCount: 0 });
    // "Invoices" has no grant of its own and isn't owner/admin/creator — visible only as an
    // ancestor of the granted "Sept", never full access.
    expect(byId.get("invoices")).toMatchObject({ accessLevel: "ancestor", documentCount: 0, childFolderCount: 1 });
  });

  it("treats the org owner/admin as full access to every folder", async () => {
    const from = vi.fn((table: string) => {
      if (table === "folders") return makeFoldersTable(() => [invoices]);
      if (table === "folder_access") {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: [], error: null }) };
      }
      if (table === "organization_members") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { role: "owner" }, error: null })
        };
      }
      return undefined;
    });
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const ctx = makeCtx({ from, rpc } as never);
    const { listFolderTree } = await import("./folders.service");

    const result = await listFolderTree(ctx);

    expect(result[0]).toMatchObject({ accessLevel: "full" });
  });
});
