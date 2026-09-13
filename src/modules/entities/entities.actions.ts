"use server";

import { requireFeature } from "@/modules/auth/authorization";
import { buildRequestContext } from "@/lib/service-context";
import {
  addIdentifierSchema,
  createEntitySchema,
  updateEntitySchema
} from "@/modules/entities/entities.schemas";
import {
  addIdentifier,
  createEntity,
  deleteEntity,
  getEntity,
  listEntities,
  listEntityIdentifiers,
  removeIdentifier,
  updateEntity
} from "@/modules/entities/entities.service";

// Typed Server Actions (ADR-0009), not FormData/redirect-based — Milestone 6 wires these up to
// dialog/picker UI rather than full-page form posts, matching specs/05's "two interactions max"
// connection UI requirement.

export async function createEntityAction(input: unknown) {
  requireFeature("entities");
  const parsed = createEntitySchema.parse(input);
  const ctx = await buildRequestContext();
  return createEntity(ctx, parsed);
}

export async function updateEntityAction(entityId: string, input: unknown) {
  requireFeature("entities");
  const parsed = updateEntitySchema.parse(input);
  const ctx = await buildRequestContext();
  return updateEntity(ctx, entityId, parsed);
}

export async function getEntityAction(entityId: string) {
  requireFeature("entities");
  const ctx = await buildRequestContext();
  return getEntity(ctx, entityId);
}

export async function listEntitiesAction(input: {
  entityTypeId?: string;
  q?: string;
  status?: "active" | "archived";
  cursor?: string | null;
  limit?: number;
}) {
  requireFeature("entities");
  const ctx = await buildRequestContext();
  return listEntities(ctx, input);
}

export async function deleteEntityAction(entityId: string, options?: { force?: boolean }) {
  requireFeature("entities");
  const ctx = await buildRequestContext();
  return deleteEntity(ctx, entityId, options);
}

export async function addIdentifierAction(entityId: string, input: unknown) {
  requireFeature("entities");
  const parsed = addIdentifierSchema.parse(input);
  const ctx = await buildRequestContext();
  return addIdentifier(ctx, entityId, parsed);
}

export async function removeIdentifierAction(identifierId: string) {
  requireFeature("entities");
  const ctx = await buildRequestContext();
  return removeIdentifier(ctx, identifierId);
}

export async function listEntityIdentifiersAction(entityId: string) {
  requireFeature("entities");
  const ctx = await buildRequestContext();
  return listEntityIdentifiers(ctx, entityId);
}
