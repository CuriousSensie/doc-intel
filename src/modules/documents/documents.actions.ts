"use server";

import { logEvent } from "@/lib/events";
import { bulkEditPaperlessDocuments } from "@/lib/paperless/documents";
import { paperlessFor } from "@/lib/paperless/client";
import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { createBackgroundOperation, completeBackgroundOperation } from "@/modules/background-operations/background-operations.service";
import { listDocumentsFilterSchema } from "@/modules/documents/documents.schemas";
import {
  getDocument,
  getDocumentHistory,
  listDocumentIds,
  listDocuments,
  updateDocument,
  type ListDocumentsOptions
} from "@/modules/documents/documents.service";

// specs/05-level-1-structure.md §Bulk business actions: "select all matching filter with a
// count confirmation" — the count the user confirms before a filter-scoped bulk action fires.
export async function countDocumentsMatchingFilterAction(filter: ListDocumentsOptions = {}) {
  requireFeature("documents");
  const ctx = await buildRequestContext();
  const parsed = listDocumentsFilterSchema.parse(filter);
  const ids = await listDocumentIds(ctx.orgId, parsed);
  return { count: ids.length };
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

export async function updateDocumentAction(
  documentId: string,
  input: {
    title?: string;
    documentDate?: string;
    documentTypeId?: number | null;
    customFieldValues?: Array<{ field: number; value: unknown }>;
  }
) {
  requireFeature("documents");
  const ctx = await buildRequestContext();
  if (!ctx.actorId) throw new Error("updateDocumentAction requires an authenticated actor");
  return updateDocument(ctx.actorId, ctx.orgId, documentId, input);
}

// specs/05-level-1-structure.md §Bulk business actions: Paperless's own bulk actions (type,
// tags, correspondent, custom fields, reprocess, delete) — proxied, never reimplemented.
// Paperless applies these atomically server-side, so this is one synchronous round trip; the
// background_operations row exists only so this shows up in the same history/audit surface
// as our own bulk-connect operations, not to track async progress.
export async function bulkEditDocumentsAction(input: {
  paperlessDocumentIds: number[];
  method: Parameters<typeof bulkEditPaperlessDocuments>[1]["method"];
  parameters?: Record<string, unknown>;
}) {
  requireFeature("documents");
  const ctx = await buildRequestContext();

  const operation = await createBackgroundOperation(ctx, {
    kind: "bulk_paperless_edit",
    params: { method: input.method, parameters: input.parameters },
    totalCount: input.paperlessDocumentIds.length
  });

  const client = await paperlessFor(ctx.orgId);
  await bulkEditPaperlessDocuments(client, {
    documentIds: input.paperlessDocumentIds,
    method: input.method,
    parameters: input.parameters
  });

  await completeBackgroundOperation(ctx, operation.id, {
    successCount: input.paperlessDocumentIds.length,
    failureCount: 0
  });

  await logEvent({
    actorId: ctx.actorId,
    action: "document.bulk_edit",
    entityType: "document",
    entityId: operation.id,
    organizationId: ctx.orgId,
    metadata: { method: input.method, count: input.paperlessDocumentIds.length }
  });

  return { operationId: operation.id };
}
