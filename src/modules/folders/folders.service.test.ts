import { describe, expect, it, vi } from "vitest";

import type { ServiceContext } from "@/lib/service-context";

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

describe("moveDocumentToFolder", () => {
  it("requires edit access to both the document and the destination folder", async () => {
    const rpc = vi.fn((fn: string) => {
      if (fn === "can_edit_document") return Promise.resolve({ data: true, error: null });
      if (fn === "can_access_folder") return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const update = vi.fn().mockReturnThis();
    const eq = vi.fn().mockReturnThis();
    const from = vi.fn().mockReturnValue({ update, eq });
    const ctx = makeCtx({ rpc, from } as never);
    const { moveDocumentToFolder } = await import("./folders.service");

    await moveDocumentToFolder(ctx, "doc-1", "folder-1");

    expect(rpc).toHaveBeenCalledWith("can_edit_document", { p_document_id: "doc-1" });
    expect(rpc).toHaveBeenCalledWith("can_access_folder", { p_folder_id: "folder-1", p_require: "edit" });
    expect(update).toHaveBeenCalledWith({ folder_id: "folder-1" });
  });

  it("rejects without touching the database when the caller cannot edit the document", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const from = vi.fn();
    const ctx = makeCtx({ rpc, from } as never);
    const { moveDocumentToFolder } = await import("./folders.service");

    await expect(moveDocumentToFolder(ctx, "doc-1", "folder-1")).rejects.toMatchObject({
      code: "authorization_error"
    });
    expect(from).not.toHaveBeenCalled();
  });
});
