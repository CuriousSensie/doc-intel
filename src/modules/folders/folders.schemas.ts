import { z } from "zod";

import { conditionNodeSchema } from "@/modules/rules/rules.schemas";

// ADR-0019: folders reuse the rules engine's condition grammar verbatim for their own auto-filing
// pattern (evaluated by evaluateFolderMatchesForDocument on document.ingested), never a second
// matching DSL.
export const folderMatchConditionsSchema = conditionNodeSchema;

export const folderPermissionSchema = z.enum(["view", "edit"]);
export type FolderPermission = z.infer<typeof folderPermissionSchema>;

export const createFolderSchema = z.object({
  parentFolderId: z.string().uuid().nullable(),
  name: z.string().trim().min(1).max(200),
  matchConditions: folderMatchConditionsSchema.nullable().optional()
});
export type CreateFolderInput = z.infer<typeof createFolderSchema>;

export const renameFolderSchema = z.object({
  folderId: z.string().uuid(),
  name: z.string().trim().min(1).max(200)
});

export const moveFolderSchema = z.object({
  folderId: z.string().uuid(),
  newParentFolderId: z.string().uuid().nullable()
});

export const updateFolderMatchConditionsSchema = z.object({
  folderId: z.string().uuid(),
  matchConditions: folderMatchConditionsSchema.nullable()
});

export const deleteFolderModeSchema = z.enum([
  "require_empty",
  "reassign_documents_to_null",
  "reassign_documents_to",
  "cascade_delete_subfolders"
]);
export type DeleteFolderMode = z.infer<typeof deleteFolderModeSchema>;

export const deleteFolderSchema = z.object({
  folderId: z.string().uuid(),
  mode: deleteFolderModeSchema.default("require_empty"),
  reassignToFolderId: z.string().uuid().nullable().optional()
});

export const grantFolderAccessSchema = z.object({
  folderId: z.string().uuid(),
  userId: z.string().uuid(),
  permission: folderPermissionSchema
});

export const revokeFolderAccessSchema = z.object({
  folderId: z.string().uuid(),
  userId: z.string().uuid()
});

export const moveDocumentsToFolderSchema = z.object({
  documentIds: z.array(z.string().uuid()).min(1),
  folderId: z.string().uuid().nullable()
});
