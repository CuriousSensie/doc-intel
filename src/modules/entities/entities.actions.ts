"use server";

import { redirect } from "next/navigation";

import { requireFeature } from "@/modules/auth/authorization";
import { withStatus } from "@/modules/auth/redirects";
import { buildRequestContext } from "@/lib/service-context";
import {
  addIdentifierSchema,
  createEntitySchema,
  updateEntitySchema
} from "@/modules/entities/entities.schemas";
import {
  addIdentifier,
  countEntitiesByType,
  createEntity,
  deleteEntity,
  getEntity,
  listEntities,
  listEntityIdentifiers,
  removeIdentifier,
  updateEntity
} from "@/modules/entities/entities.service";
import { getEntityType, getVisibleFieldSchema } from "@/modules/entity-types/entity-types.service";

function redirectWithError(path: string, error: unknown): never {
  const message = error instanceof Error ? error.message : "Something went wrong";
  redirect(withStatus(path, "error", message));
}

const FIELD_PREFIX = "field_";

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

export async function countEntitiesByTypeAction() {
  requireFeature("entities");
  const ctx = await buildRequestContext();
  return countEntitiesByType(ctx);
}

// Plain-form variant (native <form action>, redirect on completion) for the entity list page's
// "new entity" form — matches this codebase's existing form convention. Dynamic field inputs are
// named `field_<key>` so this can build `data` without the caller needing a typed shape.
export async function createEntityFormAction(formData: FormData) {
  requireFeature("entities");
  const ctx = await buildRequestContext();
  const entityTypeId = String(formData.get("entityTypeId"));
  const entityTypeKey = String(formData.get("entityTypeKey"));
  const listPath = `/dashboard/entities/${entityTypeKey}`;

  try {
    const entityType = await getEntityType(ctx, entityTypeId);
    const fieldSchema = getVisibleFieldSchema(entityType);
    const data: Record<string, unknown> = {};

    for (const field of fieldSchema) {
      const raw = formData.get(`${FIELD_PREFIX}${field.key}`);
      if (raw === null || raw === "") continue;
      data[field.key] = field.type === "boolean" ? raw === "on" : raw;
    }

    const parsed = createEntitySchema.parse({
      entityTypeId,
      displayName: formData.get("displayName"),
      data
    });
    await createEntity(ctx, parsed);
  } catch (error) {
    redirectWithError(listPath, error);
  }

  // A bare redirect() back to the page the form was already on doesn't change the URL, so
  // Next.js has nothing telling it this route's data is stale — the list would keep showing its
  // pre-submission render (found live: the new entity silently missing until a manual reload).
  // Appending a query param, same as the error path already does via withStatus(), is what
  // actually forces a fresh fetch.
  redirect(withStatus(listPath, "message", "Created"));
}
