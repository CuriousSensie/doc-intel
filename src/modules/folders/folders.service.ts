import { logEvent } from "@/lib/events";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/errors";
import type { ServiceContext } from "@/lib/service-context";
import { buildDocumentSubjectContext, type DocumentSubjectContext } from "@/modules/rules/rules.context";
import { evaluateConditions } from "@/modules/rules/rules.evaluator";
import type { ConditionNode } from "@/modules/rules/rules.schemas";
import type { Database } from "@/types/database";

import type {
  CreateFolderInput,
  DeleteFolderMode,
  FolderPermission
} from "./folders.schemas";

type FolderRow = Database["public"]["Tables"]["folders"]["Row"];
type FolderAccessRow = Database["public"]["Tables"]["folder_access"]["Row"];

// Postgres `raise exception` (P0001) inside these RPCs carries a message meant for the user
// ("Folder not found", "You do not have access to..."), same convention as document-shares'
// share_document/unshare_document.
const RAISE_EXCEPTION = "P0001";

function toValidationOrThrow(error: { code?: string; message: string }): never {
  if (error.code === RAISE_EXCEPTION) throw new ValidationError(error.message);
  throw error;
}

export type Folder = {
  id: string;
  parentFolderId: string | null;
  name: string;
  path: string;
  depth: number;
  matchConditions: ConditionNode | null;
  createdBy: string | null;
  createdAt: string;
};

function toFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    parentFolderId: row.parent_folder_id,
    name: row.name,
    path: row.path,
    depth: row.depth,
    matchConditions: (row.match_conditions as unknown as ConditionNode | null) ?? null,
    createdBy: row.created_by,
    createdAt: row.created_at
  };
}

// Every folder the caller can see (creator/owner-admin/cascading access), shaped for the tree
// component: flat list, client builds the parent→children map itself rather than N recursive
// server round trips.
export async function listFolderTree(ctx: ServiceContext): Promise<Folder[]> {
  const { data, error } = await ctx.db
    .from("folders")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .is("deleted_at", null)
    .order("depth", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toFolder);
}

export async function getFolder(ctx: ServiceContext, folderId: string): Promise<Folder> {
  const { data, error } = await ctx.db
    .from("folders")
    .select("*")
    .eq("id", folderId)
    .eq("organization_id", ctx.orgId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Folder not found");
  return toFolder(data);
}

export async function createFolder(ctx: ServiceContext, input: CreateFolderInput): Promise<string> {
  const { data, error } = await ctx.db.rpc("create_folder", {
    p_organization_id: ctx.orgId,
    p_parent_folder_id: input.parentFolderId,
    p_name: input.name,
    p_match_conditions: (input.matchConditions ?? null) as never
  });
  if (error) toValidationOrThrow(error);
  return data as string;
}

export async function renameFolder(ctx: ServiceContext, folderId: string, name: string): Promise<void> {
  const { error } = await ctx.db.rpc("rename_folder", { p_folder_id: folderId, p_new_name: name });
  if (error) toValidationOrThrow(error);
}

export async function moveFolder(
  ctx: ServiceContext,
  folderId: string,
  newParentFolderId: string | null
): Promise<void> {
  const { error } = await ctx.db.rpc("move_folder", {
    p_folder_id: folderId,
    p_new_parent_folder_id: newParentFolderId
  });
  if (error) toValidationOrThrow(error);
}

export async function updateFolderMatchConditions(
  ctx: ServiceContext,
  folderId: string,
  matchConditions: ConditionNode | null
): Promise<void> {
  // No dedicated RPC — this is a plain column write, not access-cascading or path-recomputing
  // like create/rename/move, so it goes through the RLS-scoped table update directly (RLS's
  // folders_select_member + a manage check below are the enforcement, matching how
  // rename_folder/move_folder gate on can_manage_folder rather than trusting RLS alone for writes).
  const { data: canManage, error: manageError } = await ctx.db.rpc("can_manage_folder", {
    p_folder_id: folderId
  });
  if (manageError) throw manageError;
  if (!canManage) throw new AuthorizationError("You do not have access to edit this folder's matching pattern");

  const { error } = await ctx.db
    .from("folders")
    .update({ match_conditions: matchConditions as never })
    .eq("id", folderId)
    .eq("organization_id", ctx.orgId);
  if (error) throw error;
}

export async function deleteFolder(
  ctx: ServiceContext,
  folderId: string,
  mode: DeleteFolderMode,
  reassignToFolderId?: string | null
): Promise<void> {
  const { error } = await ctx.db.rpc("delete_folder", {
    p_folder_id: folderId,
    p_mode: mode,
    p_reassign_to_folder_id: reassignToFolderId ?? null
  });
  if (error) toValidationOrThrow(error);
}

export type FolderAccessGrant = {
  id: string;
  folderId: string;
  userId: string;
  permission: FolderPermission;
  createdAt: string;
};

function toGrant(row: FolderAccessRow): FolderAccessGrant {
  return {
    id: row.id,
    folderId: row.folder_id,
    userId: row.granted_to,
    permission: row.permission,
    createdAt: row.created_at
  };
}

export async function listFolderAccess(ctx: ServiceContext, folderId: string): Promise<FolderAccessGrant[]> {
  const { data, error } = await ctx.db
    .from("folder_access")
    .select("*")
    .eq("folder_id", folderId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toGrant);
}

export async function grantFolderAccess(
  ctx: ServiceContext,
  folderId: string,
  userId: string,
  permission: FolderPermission
): Promise<void> {
  const { error } = await ctx.db.rpc("grant_folder_access", {
    p_folder_id: folderId,
    p_user_id: userId,
    p_permission: permission
  });
  if (error) toValidationOrThrow(error);
}

export async function revokeFolderAccess(ctx: ServiceContext, folderId: string, userId: string): Promise<void> {
  const { error } = await ctx.db.rpc("revoke_folder_access", { p_folder_id: folderId, p_user_id: userId });
  if (error) toValidationOrThrow(error);
}

async function assertCanAccessFolderForEdit(ctx: ServiceContext, folderId: string): Promise<void> {
  const { data, error } = await ctx.db.rpc("can_access_folder", { p_folder_id: folderId, p_require: "edit" });
  if (error) throw error;
  if (!data) throw new AuthorizationError("You do not have edit access to this folder");
}

async function assertCanEditDocument(ctx: ServiceContext, documentId: string): Promise<void> {
  const { data, error } = await ctx.db.rpc("can_edit_document", { p_document_id: documentId });
  if (error) throw error;
  if (!data) throw new AuthorizationError("You do not have edit access to this document");
}

// Filing a document requires edit rights on both the document and the destination folder — moving
// a document doesn't just relabel it, it also changes who can see it (ADR-0019), so both sides of
// that change need to be authorized independently. `folderId: null` unfiles the document.
export async function moveDocumentToFolder(
  ctx: ServiceContext,
  documentId: string,
  folderId: string | null
): Promise<void> {
  await assertCanEditDocument(ctx, documentId);
  if (folderId) await assertCanAccessFolderForEdit(ctx, folderId);

  const { error } = await ctx.db
    .from("documents")
    .update({ folder_id: folderId })
    .eq("id", documentId)
    .eq("organization_id", ctx.orgId);
  if (error) throw error;

  // Fire-and-forget, matching updateDocument()'s own document.updated logging — folder placement
  // is a plain field write like document_type/correspondent, not one of ADR-0008's fixed list of
  // mutations requiring a same-transaction atomic audit row (that list is share/unshare and
  // grant/revoke_folder_access, already atomic RPCs above).
  await logEvent({
    actorId: ctx.actorId,
    action: "document.moved_to_folder",
    entityType: "document",
    entityId: documentId,
    organizationId: ctx.orgId,
    metadata: { folderId, via: "user" }
  });
}

// Bulk version: narrows to editable documents first via filter_document_ids (same choke point
// bulk-edit/export already use), then files each editable one — a document the caller can't edit
// is silently skipped rather than failing the whole batch, matching bulkEditDocuments' behavior.
export async function moveDocumentsToFolder(
  ctx: ServiceContext,
  documentIds: string[],
  folderId: string | null
): Promise<{ movedCount: number; skippedCount: number }> {
  if (documentIds.length === 0) return { movedCount: 0, skippedCount: 0 };
  if (folderId) await assertCanAccessFolderForEdit(ctx, folderId);

  const { data: editableIds, error } = await ctx.db.rpc("filter_document_ids", {
    p_organization_id: ctx.orgId,
    p_ids: documentIds,
    p_required: "edit"
  });
  if (error) throw error;

  const allowed = editableIds ?? [];
  if (allowed.length === 0) return { movedCount: 0, skippedCount: documentIds.length };

  const { error: updateError } = await ctx.db
    .from("documents")
    .update({ folder_id: folderId })
    .in("id", allowed)
    .eq("organization_id", ctx.orgId);
  if (updateError) throw updateError;

  await logEvent({
    actorId: ctx.actorId,
    action: "document.moved_to_folder",
    entityType: "document",
    organizationId: ctx.orgId,
    metadata: { folderId, documentIds: allowed, via: "user" }
  });

  return { movedCount: allowed.length, skippedCount: documentIds.length - allowed.length };
}

// ADR-0019's "folders have a matching pattern, like tags/document types" — evaluated on every
// document.ingested fire (worker/jobs/run-rule.ts), independent of the tenant's authored rules:
// a folder's own match_conditions is checked directly, not through the rules table. Deepest
// folder first, first match wins — a document matching both "Documents" and
// "Documents/Invoices/2025" lands in the more specific one. Respects "user edits win over rules
// always" (specs/07) via field_provenance, exactly like a rule-dispatched field write would.
export async function evaluateFolderMatchesForDocument(
  ctx: ServiceContext,
  documentId: string,
  subject?: DocumentSubjectContext
): Promise<void> {
  const { data: folders, error } = await ctx.db
    .from("folders")
    .select("id, match_conditions")
    .eq("organization_id", ctx.orgId)
    .is("deleted_at", null)
    .not("match_conditions", "is", null)
    .order("depth", { ascending: false });
  if (error) throw error;
  if (!folders || folders.length === 0) return;

  const { data: userOwned, error: provenanceError } = await ctx.db
    .from("field_provenance")
    .select("field_key")
    .eq("document_id", documentId)
    .eq("field_key", "document.folder_id")
    .eq("updated_by", "user")
    .maybeSingle();
  if (provenanceError) throw provenanceError;
  if (userOwned) return;

  const doc = subject ?? (await buildDocumentSubjectContext(ctx, documentId));

  for (const folder of folders) {
    const conditions = folder.match_conditions as unknown as ConditionNode;
    const { matched } = evaluateConditions(conditions, doc);
    if (!matched) continue;

    const { error: updateError } = await ctx.db
      .from("documents")
      .update({ folder_id: folder.id })
      .eq("id", documentId)
      .eq("organization_id", ctx.orgId);
    if (updateError) throw updateError;

    const { error: provenanceWriteError } = await ctx.db.from("field_provenance").upsert(
      {
        organization_id: ctx.orgId,
        document_id: documentId,
        field_key: "document.folder_id",
        updated_by: "system",
        source_id: folder.id,
        updated_at: new Date().toISOString()
      },
      { onConflict: "document_id,field_key" }
    );
    if (provenanceWriteError) throw provenanceWriteError;

    await logEvent({
      actorId: null,
      actorType: "system",
      action: "document.moved_to_folder",
      entityType: "document",
      entityId: documentId,
      organizationId: ctx.orgId,
      metadata: { folderId: folder.id, via: "folder_match" }
    });
    return;
  }
}
