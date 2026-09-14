"use server";

import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import {
  createBackgroundOperation,
  getBackgroundOperation
} from "@/modules/background-operations/background-operations.service";
import { listDocumentIds, type ListDocumentsOptions } from "@/modules/documents/documents.service";

export type CreateExportInput = {
  documentIds?: string[];
  filter?: ListDocumentsOptions;
  format: "csv" | "xlsx";
};

// specs/05-level-1-structure.md §Export: "exports over 5,000 rows are always async." Always
// runs through the worker regardless of size — same download-link UX either way, and a small
// export still finishes in well under a second on the poll cadence the UI already uses for
// bulk actions.
export async function createExportAction(input: CreateExportInput) {
  requireFeature("documents");
  const ctx = await buildRequestContext();

  const documentIds = input.documentIds ?? (await listDocumentIds(ctx.orgId, input.filter ?? {}));

  const operation = await createBackgroundOperation(ctx, {
    kind: "export",
    params: { format: input.format, scope: input.documentIds ? "selection" : "filter" },
    totalCount: documentIds.length
  });

  await enqueue(QUEUE_NAMES.export, {
    orgId: ctx.orgId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    operationId: operation.id,
    documentIds,
    format: input.format
  });

  return { operationId: operation.id, total: documentIds.length };
}

export async function getExportAction(operationId: string) {
  const ctx = await buildRequestContext();
  return getBackgroundOperation(ctx, operationId);
}
