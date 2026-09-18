"use server";

import { logEvent } from "@/lib/events";
import {
  bulkEditPaperlessDocuments,
  createPaperlessCorrespondent,
  createPaperlessDocumentType,
  createPaperlessTag
} from "@/lib/paperless/documents";
import { paperlessFor } from "@/lib/paperless/client";
import {
  addCachedCorrespondent,
  addCachedDocumentType,
  addCachedTag
} from "@/lib/paperless/metadata-cache";
import { buildRequestContext } from "@/lib/service-context";
import { ValidationError } from "@/lib/errors";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { listCustomFieldDefs } from "@/modules/custom-fields/custom-field-defs.service";
import {
  createBackgroundOperation,
  completeBackgroundOperation
} from "@/modules/background-operations/background-operations.service";
import {
  createPaperlessMetaSchema,
  listDocumentsFilterSchema,
  updateDocumentSchema
} from "@/modules/documents/documents.schemas";
import {
  deleteDocument,
  getAdjacentDocumentId,
  getDocument,
  getDocumentHistory,
  getDocumentRow,
  getPaperlessDocumentIdsForUuids,
  listDocuments,
  listDocumentIds,
  recordBulkEditProvenance,
  updateBulkEditMirror,
  updateDocument,
  type ListDocumentsOptions
} from "@/modules/documents/documents.service";

// specs/05-level-1-structure.md §Bulk business actions: "select all matching filter with a
// count confirmation" — the count the user confirms before a filter-scoped bulk action fires.
export async function countDocumentsMatchingFilterAction(filter: ListDocumentsOptions = {}) {
  requireFeature("documents");
  const ctx = await buildRequestContext();
  const parsed = listDocumentsFilterSchema.parse(filter);
  const { totalCount } = await listDocuments(ctx.orgId, { ...parsed, page: 1, pageSize: 10 });
  return { count: totalCount };
}

export async function listDocumentsAction(options: ListDocumentsOptions = {}) {
  requireFeature("documents");
  const ctx = await buildRequestContext();
  const parsed = listDocumentsFilterSchema.parse(options);
  return listDocuments(ctx.orgId, parsed);
}

// No buildRequestContext() here on purpose — that resolves an active org first (a real, measured
// round trip), which getDocument()/getDocumentHistory() don't need: RLS scopes the read by
// itself. requireUser() alone is enough (auth only, no org resolution).
export async function getDocumentAction(documentId: string) {
  requireFeature("documents");
  await requireUser();
  return getDocument(documentId);
}

export async function getDocumentHistoryAction(documentId: string) {
  requireFeature("documents");
  await requireUser();
  return getDocumentHistory(documentId);
}

export async function updateDocumentAction(documentId: string, input: unknown) {
  requireFeature("documents");
  const parsed = updateDocumentSchema.parse(input);
  const ctx = await buildRequestContext();
  if (!ctx.actorId) throw new Error("updateDocumentAction requires an authenticated actor");

  let customFieldValues: Array<{ field: number; value: unknown }> | undefined;
  if (parsed.customFieldValues !== undefined) {
    const defs = await listCustomFieldDefs(ctx);
    const defByKey = new Map(defs.map((def) => [def.key, def]));
    customFieldValues = parsed.customFieldValues.map(({ key, value }) => {
      const def = defByKey.get(key);
      if (!def?.paperless_custom_field_id) {
        throw new ValidationError(`Custom field "${key}" is not backed by Paperless`);
      }
      return { field: def.paperless_custom_field_id, value };
    });
  }

  return updateDocument(ctx.actorId, ctx.orgId, documentId, { ...parsed, customFieldValues });
}

// specs/03-api.md DELETE /documents/:id, wired to the document detail page's "Delete" action.
export async function deleteDocumentAction(documentId: string) {
  requireFeature("documents");
  const ctx = await buildRequestContext();
  if (!ctx.actorId) throw new Error("deleteDocumentAction requires an authenticated actor");
  await deleteDocument(ctx.actorId, ctx.orgId, documentId);
}

// The Details tab's inline "create tag/correspondent/document type" pickers — creates the
// Paperless object with proper tenant owner/group permissions (specs/12-agent-rules.md rule 4)
// and returns it so the caller can immediately select it without a second round trip.
export async function createPaperlessMetaAction(input: unknown) {
  requireFeature("documents");
  const parsed = createPaperlessMetaSchema.parse(input);
  const ctx = await buildRequestContext();

  const client = await paperlessFor(ctx.orgId);
  const ownership = client.ownership;
  if (!ownership) throw new Error("Expected tenant Paperless ownership");

  if (parsed.kind === "tag") {
    const tag = await createPaperlessTag(client, parsed.name, ownership, parsed.color);
    await addCachedTag(ctx.orgId, tag);
    return tag;
  }
  if (parsed.kind === "correspondent") {
    const correspondent = await createPaperlessCorrespondent(client, parsed.name, ownership);
    await addCachedCorrespondent(ctx.orgId, correspondent);
    return correspondent;
  }
  const documentType = await createPaperlessDocumentType(client, parsed.name, ownership);
  await addCachedDocumentType(ctx.orgId, documentType);
  return documentType;
}

// Paperless-ngx-style next/previous document navigation, scoped to the filter+sort the caller
// is currently viewing (see getAdjacentDocumentId's own comment).
export async function getAdjacentDocumentAction(
  documentId: string,
  direction: "next" | "previous",
  filter: ListDocumentsOptions = {}
) {
  requireFeature("documents");
  const parsedFilter = listDocumentsFilterSchema.parse(filter);
  const ctx = await buildRequestContext();
  const current = await getDocumentRow(documentId);
  return getAdjacentDocumentId(ctx.orgId, current, parsedFilter, direction);
}

// specs/05-level-1-structure.md §Bulk business actions: Paperless's own bulk actions (type,
// tags, correspondent, custom fields, reprocess, delete) — proxied, never reimplemented.
// Paperless applies these atomically server-side, so this is one synchronous round trip; the
// background_operations row exists only so this shows up in the same history/audit surface
// as our own bulk-connect operations, not to track async progress.
export type BulkEditDocumentsInput = {
  documentIds?: string[];
  filter?: ListDocumentsOptions;
  method: Parameters<typeof bulkEditPaperlessDocuments>[1]["method"];
  parameters?: Record<string, unknown>;
};

export async function bulkEditDocumentsAction(input: BulkEditDocumentsInput) {
  requireFeature("documents");
  const ctx = await buildRequestContext();
  const parsedFilter = listDocumentsFilterSchema.parse(input.filter ?? {});
  const documentIds = input.documentIds ?? (await listDocumentIds(ctx.orgId, parsedFilter));
  const paperlessDocumentIds = await getPaperlessDocumentIdsForUuids(ctx.orgId, documentIds);

  const operation = await createBackgroundOperation(ctx, {
    kind: "bulk_paperless_edit",
    params: { method: input.method, parameters: input.parameters },
    totalCount: paperlessDocumentIds.length
  });

  const client = await paperlessFor(ctx.orgId);
  await bulkEditPaperlessDocuments(client, {
    documentIds: paperlessDocumentIds,
    method: input.method,
    parameters: input.parameters
  });
  await updateBulkEditMirror(ctx.orgId, documentIds, input.method, input.parameters);

  if (input.method !== "delete" && input.method !== "reprocess") {
    await recordBulkEditProvenance(ctx, documentIds, input.method, input.parameters);
  }

  await completeBackgroundOperation(ctx, operation.id, {
    successCount: paperlessDocumentIds.length,
    failureCount: 0
  });

  await logEvent({
    actorId: ctx.actorId,
    action: "document.bulk_edit",
    entityType: "document",
    entityId: operation.id,
    organizationId: ctx.orgId,
    metadata: { method: input.method, count: paperlessDocumentIds.length }
  });

  return { operationId: operation.id };
}
