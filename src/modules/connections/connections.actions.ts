"use server";

import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import {
  createConnectionSchema,
  getConnectionsSchema
} from "@/modules/connections/connections.schemas";
import {
  createConnection,
  deleteConnection,
  getConnections
} from "@/modules/connections/connections.service";
import { mergeEntities } from "@/modules/connections/entity-merge.service";
import { mergeEntitiesSchema } from "@/modules/entities/entities.schemas";

export async function createConnectionAction(input: unknown) {
  requireFeature("entities");
  const parsed = createConnectionSchema.parse(input);
  const ctx = await buildRequestContext();
  return createConnection(ctx, parsed);
}

export async function deleteConnectionAction(connectionId: string) {
  requireFeature("entities");
  const ctx = await buildRequestContext();
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
