"use server";

import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";

import {
  createFolderSchema,
  deleteFolderSchema,
  grantFolderAccessSchema,
  moveDocumentsToFolderSchema,
  moveFolderSchema,
  renameFolderSchema,
  resolveOrCreateFolderPathsSchema,
  revokeFolderAccessSchema,
  updateFolderMatchConditionsSchema
} from "./folders.schemas";
import {
  createFolder,
  deleteFolder,
  type Folder,
  type FolderAccessGrant,
  getFolder,
  grantFolderAccess,
  listFolderAccess,
  listFolderTree,
  moveDocumentsToFolder,
  moveFolder,
  renameFolder,
  resolveOrCreateFolderPaths,
  revokeFolderAccess,
  updateFolderMatchConditions
} from "./folders.service";

export async function listFolderTreeAction(): Promise<Folder[]> {
  requireFeature("folders");
  const ctx = await buildRequestContext();
  return listFolderTree(ctx);
}

export async function getFolderAction(folderId: string): Promise<Folder> {
  requireFeature("folders");
  const ctx = await buildRequestContext();
  return getFolder(ctx, folderId);
}

export async function createFolderAction(input: unknown): Promise<string> {
  requireFeature("folders");
  const parsed = createFolderSchema.parse(input);
  const ctx = await buildRequestContext();
  return createFolder(ctx, parsed);
}

export async function renameFolderAction(input: unknown): Promise<void> {
  requireFeature("folders");
  const parsed = renameFolderSchema.parse(input);
  const ctx = await buildRequestContext();
  await renameFolder(ctx, parsed.folderId, parsed.name);
}

export async function moveFolderAction(input: unknown): Promise<void> {
  requireFeature("folders");
  const parsed = moveFolderSchema.parse(input);
  const ctx = await buildRequestContext();
  await moveFolder(ctx, parsed.folderId, parsed.newParentFolderId);
}

export async function updateFolderMatchConditionsAction(input: unknown): Promise<void> {
  requireFeature("folders");
  const parsed = updateFolderMatchConditionsSchema.parse(input);
  const ctx = await buildRequestContext();
  await updateFolderMatchConditions(ctx, parsed.folderId, parsed.matchConditions);
}

export async function deleteFolderAction(input: unknown): Promise<void> {
  requireFeature("folders");
  const parsed = deleteFolderSchema.parse(input);
  const ctx = await buildRequestContext();
  await deleteFolder(ctx, parsed.folderId, parsed.mode, parsed.reassignToFolderId);
}

export async function listFolderAccessAction(folderId: string): Promise<FolderAccessGrant[]> {
  requireFeature("folders");
  const ctx = await buildRequestContext();
  return listFolderAccess(ctx, folderId);
}

export async function grantFolderAccessAction(input: unknown): Promise<void> {
  requireFeature("folders");
  const parsed = grantFolderAccessSchema.parse(input);
  const ctx = await buildRequestContext();
  await grantFolderAccess(ctx, parsed.folderId, parsed.userId, parsed.permission);
}

export async function revokeFolderAccessAction(input: unknown): Promise<void> {
  requireFeature("folders");
  const parsed = revokeFolderAccessSchema.parse(input);
  const ctx = await buildRequestContext();
  await revokeFolderAccess(ctx, parsed.folderId, parsed.userId);
}

export async function moveDocumentsToFolderAction(
  input: unknown
): Promise<{ movedCount: number; skippedCount: number }> {
  requireFeature("folders");
  const parsed = moveDocumentsToFolderSchema.parse(input);
  const ctx = await buildRequestContext();
  return moveDocumentsToFolder(ctx, parsed.documentIds, parsed.folderId);
}

// Phase D bulk folder upload — called once per upload batch with every unique directory path
// the picked files span, before any file itself is uploaded (see folder-upload-form.tsx).
export async function resolveOrCreateFolderPathsAction(paths: string[]): Promise<Record<string, string>> {
  requireFeature("folders");
  const parsed = resolveOrCreateFolderPathsSchema.parse({ paths });
  const ctx = await buildRequestContext();
  return resolveOrCreateFolderPaths(ctx, parsed.paths);
}
