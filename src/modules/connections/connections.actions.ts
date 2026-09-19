"use server";

import { AuthorizationError, NotFoundError } from "@/lib/errors";
import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import {
  createBackgroundOperation,
  completeBackgroundOperation,
  getBackgroundOperation
} from "@/modules/background-operations/background-operations.service";
import {
  createConnectionSchema,
  getConnectionsSchema
} from "@/modules/connections/connections.schemas";
import {
  bulkCreateConnections,
  createConnection,
  deleteConnection,
  getConnections,
  type ConnectableKind,
  type Relation
} from "@/modules/connections/connections.service";
import { mergeEntities } from "@/modules/connections/entity-merge.service";
import type { ServiceContext } from "@/lib/service-context";
import {
  filterDocumentIds,
  listDocumentIds,
  type ListDocumentsOptions
} from "@/modules/documents/documents.service";
import { mergeEntitiesSchema } from "@/modules/entities/entities.schemas";

// specs/05-level-1-structure.md §Bulk business actions: "async execution above 50 items with
// progress." Below this, the round trip is fast enough to just await inline and give the user
// an immediate result instead of a poll loop.
const BULK_ASYNC_THRESHOLD = 50;

export type BulkConnectDocumentsInput = {
  documentIds?: string[];
  filter?: ListDocumentsOptions;
  targetKind: ConnectableKind;
  targetId: string;
  relation?: Relation;
};

// `notPermitted` = selected documents the caller only has view access to (or none) — skipped, not
// failed, so the UI can say so instead of silently connecting fewer documents.
export type BulkConnectResultSummary =
  | {
      mode: "sync";
      operationId: string;
      created: number;
      skipped: number;
      failed: number;
      notPermitted: number;
    }
  | { mode: "async"; operationId: string; total: number; notPermitted: number };

// Connecting/disconnecting changes a document's connection list, so it needs edit rights on
// every document endpoint (a 'view' share is not enough). Enforced here rather than in
// createConnection(): that service is also called by the rules engine/worker with an admin
// client and no auth.uid(), which the permission functions can't evaluate.
async function assertCanEditDocumentEndpoints(
  ctx: ServiceContext,
  endpoints: Array<{ kind: ConnectableKind; id: string }>,
  options: { allowDeleted?: boolean } = {}
): Promise<void> {
  const documentIds = [...new Set(endpoints.filter((e) => e.kind === "document").map((e) => e.id))];
  if (documentIds.length === 0) return;

  const editable = new Set(await filterDocumentIds(ctx.orgId, documentIds, "edit"));
  let blocked = documentIds.filter((id) => !editable.has(id));

  // Removing a link to an already-deleted document must stay possible (that's how a dangling
  // connection gets cleaned up) — deleted rows are still readable to whoever could read them.
  if (blocked.length > 0 && options.allowDeleted) {
    const { data, error } = await ctx.db
      .from("documents")
      .select("id")
      .in("id", blocked)
      .not("deleted_at", "is", null);
    if (error) throw error;
    const deleted = new Set((data ?? []).map((row) => row.id));
    blocked = blocked.filter((id) => !deleted.has(id));
  }

  if (blocked.length > 0) {
    throw new AuthorizationError("You do not have edit access to this document");
  }
}

// Selection across pages ("documentIds") or "select all matching filter" (resolved server-
// side via listDocumentIds, capped the same way exports are — specs/05's own scaling note).
export async function bulkConnectDocumentsAction(
  input: BulkConnectDocumentsInput
): Promise<BulkConnectResultSummary> {
  requireFeature("documents");
  const ctx = await buildRequestContext();

  const requestedIds = input.documentIds ?? (await listDocumentIds(ctx.orgId, input.filter ?? {}));
  const sourceIds = await filterDocumentIds(ctx.orgId, requestedIds, "edit");
  const notPermitted = requestedIds.length - sourceIds.length;
  if (input.targetKind === "document") {
    await assertCanEditDocumentEndpoints(ctx, [{ kind: "document", id: input.targetId }]);
  }

  const operation = await createBackgroundOperation(ctx, {
    kind: "bulk_connect",
    params: { targetKind: input.targetKind, targetId: input.targetId, relation: input.relation },
    totalCount: sourceIds.length
  });

  if (sourceIds.length <= BULK_ASYNC_THRESHOLD) {
    const result = await bulkCreateConnections(ctx, {
      sourceKind: "document",
      sourceIds,
      targetKind: input.targetKind,
      targetId: input.targetId,
      relation: input.relation,
      createdVia: "bulk"
    });

    await completeBackgroundOperation(ctx, operation.id, {
      successCount: result.createdIds.length,
      failureCount: result.failures.length,
      failures: result.failures,
      result: { connectionIds: result.createdIds, skippedIds: result.skippedIds }
    });

    return {
      mode: "sync",
      operationId: operation.id,
      created: result.createdIds.length,
      skipped: result.skippedIds.length,
      failed: result.failures.length,
      notPermitted
    };
  }

  await enqueue(QUEUE_NAMES.bulkAction, {
    orgId: ctx.orgId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    operationId: operation.id,
    sourceKind: "document" as ConnectableKind,
    sourceIds,
    targetKind: input.targetKind,
    targetId: input.targetId,
    relation: input.relation
  });

  return { mode: "async", operationId: operation.id, total: sourceIds.length, notPermitted };
}

export async function getBackgroundOperationAction(operationId: string) {
  const ctx = await buildRequestContext();
  return getBackgroundOperation(ctx, operationId);
}

// Session-scoped undo (spec: "undo for the last bulk connect within the session") — the
// client tracks the last operationId itself; this just reverses the connections it created.
// Tolerates a connection already gone (deleted a second time, or manually removed since).
export async function undoBulkConnectAction(operationId: string): Promise<void> {
  requireFeature("documents");
  const ctx = await buildRequestContext();
  const operation = await getBackgroundOperation(ctx, operationId);

  if (operation.kind !== "bulk_connect" || operation.created_by !== ctx.actorId) {
    throw new NotFoundError("Operation not found");
  }

  const connectionIds = (operation.result as { connectionIds?: string[] } | null)?.connectionIds ?? [];
  for (const connectionId of connectionIds) {
    try {
      await deleteConnection(ctx, connectionId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
}

export async function createConnectionAction(input: unknown) {
  requireFeature("entities");
  const parsed = createConnectionSchema.parse(input);
  const ctx = await buildRequestContext();
  await assertCanEditDocumentEndpoints(ctx, [
    { kind: parsed.sourceKind, id: parsed.sourceId },
    { kind: parsed.targetKind, id: parsed.targetId }
  ]);
  return createConnection(ctx, parsed);
}

export async function deleteConnectionAction(connectionId: string) {
  requireFeature("entities");
  const ctx = await buildRequestContext();

  const { data: connection, error } = await ctx.db
    .from("connections")
    .select("source_kind, source_id, target_kind, target_id")
    .eq("id", connectionId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  if (error) throw error;
  if (!connection) throw new NotFoundError("Connection not found");

  await assertCanEditDocumentEndpoints(
    ctx,
    [
      { kind: connection.source_kind as ConnectableKind, id: connection.source_id },
      { kind: connection.target_kind as ConnectableKind, id: connection.target_id }
    ],
    { allowDeleted: true }
  );
  return deleteConnection(ctx, connectionId);
}

export async function getConnectionsAction(input: unknown) {
  requireFeature("entities");
  const parsed = getConnectionsSchema.parse(input);
  const ctx = await buildRequestContext();
  return getConnections(ctx, parsed.kind, parsed.id);
}

export async function mergeEntitiesAction(input: unknown) {
  requireFeature("entities");
  const parsed = mergeEntitiesSchema.parse(input);
  const ctx = await buildRequestContext();
  return mergeEntities(ctx, { keepId: parsed.keepId, mergeId: parsed.mergeId });
}
