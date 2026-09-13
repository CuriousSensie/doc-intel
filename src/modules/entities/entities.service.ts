import { ConflictError, NotFoundError, UnprocessableError } from "@/lib/errors";
import { logEvent } from "@/lib/events";
import { decodeCursor, encodeCursor } from "@/lib/pagination";
import type { ServiceContext } from "@/lib/service-context";
import { getEntityType, getVisibleFieldSchema } from "@/modules/entity-types/entity-types.service";
import { validateEntityData } from "@/modules/entities/field-schema";
import { normalizeIdentifier } from "@/modules/entities/identifier-normalization";
import type { Database, Json } from "@/types/database";

export type Entity = Database["public"]["Tables"]["entities"]["Row"];
export type EntityIdentifier = Database["public"]["Tables"]["entity_identifiers"]["Row"];

const UNIQUE_VIOLATION = "23505";
const DEFAULT_PAGE_SIZE = 25;

async function fetchEntity(ctx: ServiceContext, entityId: string): Promise<Entity> {
  const { data, error } = await ctx.db
    .from("entities")
    .select("*")
    .eq("id", entityId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NotFoundError("Entity not found");
  return data;
}

// Auto-promotes any field.identifier_kind → an entity_identifiers row, per specs/05's "no
// separate UI" requirement. Reconciles against the entity's current identifiers: adds/updates
// what changed, removes what was cleared. A normalized collision with another entity throws
// ConflictError rather than silently reassigning someone else's identifier.
async function syncIdentifiersFromData(
  ctx: ServiceContext,
  entityId: string,
  fieldSchema: ReturnType<typeof getVisibleFieldSchema>,
  data: Record<string, unknown>
): Promise<void> {
  const identifierFields = fieldSchema.filter((field) => field.identifier_kind);
  if (identifierFields.length === 0) return;

  const { data: existing, error: existingError } = await ctx.db
    .from("entity_identifiers")
    .select("*")
    .eq("entity_id", entityId)
    .eq("organization_id", ctx.orgId);

  if (existingError) throw existingError;

  const existingByKind = new Map((existing ?? []).map((row) => [row.kind, row]));

  for (const field of identifierFields) {
    const kind = field.identifier_kind as string;
    const rawValue = data[field.key];
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    const current = existingByKind.get(kind);

    if (!value) {
      if (current) {
        const { error } = await ctx.db.from("entity_identifiers").delete().eq("id", current.id);
        if (error) throw error;
      }
      continue;
    }

    const normalized = normalizeIdentifier(kind, value);
    if (current && current.value === value && current.normalized === normalized) continue;

    if (current) {
      const { error } = await ctx.db
        .from("entity_identifiers")
        .update({ value, normalized })
        .eq("id", current.id);

      if (error) {
        if (error.code === UNIQUE_VIOLATION) {
          throw new ConflictError(`Identifier "${value}" is already used by another entity`);
        }
        throw error;
      }
    } else {
      const { error } = await ctx.db.from("entity_identifiers").insert({
        organization_id: ctx.orgId,
        entity_id: entityId,
        kind,
        value,
        normalized
      });

      if (error) {
        if (error.code === UNIQUE_VIOLATION) {
          throw new ConflictError(`Identifier "${value}" is already used by another entity`);
        }
        throw error;
      }
    }
  }
}

export async function createEntity(
  ctx: ServiceContext,
  input: { entityTypeId: string; displayName: string; data?: Record<string, unknown> }
): Promise<Entity> {
  const entityType = await getEntityType(ctx, input.entityTypeId);
  const fieldSchema = getVisibleFieldSchema(entityType);
  const data = validateEntityData(fieldSchema, input.data ?? {});

  const { data: entity, error } = await ctx.db
    .from("entities")
    .insert({
      organization_id: ctx.orgId,
      entity_type_id: input.entityTypeId,
      display_name: input.displayName,
      data: data as Json,
      created_by: ctx.actorId
    })
    .select("*")
    .single();

  if (error) throw error;

  await syncIdentifiersFromData(ctx, entity.id, fieldSchema, data);

  await logEvent({
    actorId: ctx.actorId,
    action: "entity.created",
    entityType: "entity",
    entityId: entity.id,
    organizationId: ctx.orgId,
    metadata: { entity_type_id: input.entityTypeId }
  });

  return entity;
}

export async function updateEntity(
  ctx: ServiceContext,
  entityId: string,
  input: { displayName?: string; status?: "active" | "archived"; data?: Record<string, unknown> }
): Promise<Entity> {
  const entity = await fetchEntity(ctx, entityId);
  const entityType = await getEntityType(ctx, entity.entity_type_id);
  const fieldSchema = getVisibleFieldSchema(entityType);

  const nextData =
    input.data !== undefined
      ? validateEntityData(fieldSchema, { ...(entity.data as Record<string, unknown>), ...input.data })
      : undefined;

  const { data: updated, error } = await ctx.db
    .from("entities")
    .update({
      ...(input.displayName !== undefined ? { display_name: input.displayName } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(nextData !== undefined ? { data: nextData as Json } : {})
    })
    .eq("id", entityId)
    .eq("organization_id", ctx.orgId)
    .select("*")
    .single();

  if (error) throw error;

  if (nextData !== undefined) {
    await syncIdentifiersFromData(ctx, entityId, fieldSchema, nextData);
  }

  await logEvent({
    actorId: ctx.actorId,
    action: "entity.updated",
    entityType: "entity",
    entityId,
    organizationId: ctx.orgId
  });

  return updated;
}

export async function getEntity(ctx: ServiceContext, entityId: string): Promise<Entity> {
  return fetchEntity(ctx, entityId);
}

export async function listEntityIdentifiers(
  ctx: ServiceContext,
  entityId: string
): Promise<EntityIdentifier[]> {
  const { data, error } = await ctx.db
    .from("entity_identifiers")
    .select("*")
    .eq("entity_id", entityId)
    .eq("organization_id", ctx.orgId)
    .order("kind", { ascending: true });

  if (error) throw error;
  return data;
}

export async function listEntities(
  ctx: ServiceContext,
  options: {
    entityTypeId?: string;
    q?: string;
    status?: "active" | "archived";
    cursor?: string | null;
    limit?: number;
  } = {}
): Promise<{ items: Entity[]; nextCursor: string | null }> {
  const limit = options.limit ?? DEFAULT_PAGE_SIZE;

  let matchingIdsFromIdentifiers: string[] = [];
  if (options.q) {
    const { data, error } = await ctx.db
      .from("entity_identifiers")
      .select("entity_id")
      .eq("organization_id", ctx.orgId)
      .ilike("value", `%${options.q}%`)
      .limit(50);

    if (error) throw error;
    matchingIdsFromIdentifiers = (data ?? []).map((row) => row.entity_id);
  }

  let query = ctx.db
    .from("entities")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .is("deleted_at", null);

  if (options.entityTypeId) query = query.eq("entity_type_id", options.entityTypeId);
  if (options.status) query = query.eq("status", options.status);

  if (options.q) {
    const orParts = [`display_name.ilike.%${options.q}%`];
    if (matchingIdsFromIdentifiers.length > 0) {
      orParts.push(`id.in.(${matchingIdsFromIdentifiers.join(",")})`);
    }
    query = query.or(orParts.join(","));
  }

  const cursor = decodeCursor(options.cursor);
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
    );
  }

  query = query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  const { data, error } = await query;
  if (error) throw error;

  const items = data ?? [];
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const last = page[page.length - 1];

  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null
  };
}

// specs/03-api.md: "Soft delete; refuses if connections exist unless ?force=true".
export async function deleteEntity(
  ctx: ServiceContext,
  entityId: string,
  options: { force?: boolean } = {}
): Promise<void> {
  await fetchEntity(ctx, entityId);

  if (!options.force) {
    const { count, error } = await ctx.db
      .from("connections")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.orgId)
      .is("deleted_at", null)
      .or(
        `and(source_kind.eq.entity,source_id.eq.${entityId}),and(target_kind.eq.entity,target_id.eq.${entityId})`
      );

    if (error) throw error;
    if ((count ?? 0) > 0) {
      throw new UnprocessableError(
        "This entity has connections — pass force to delete it anyway"
      );
    }
  }

  const { error } = await ctx.db
    .from("entities")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", entityId)
    .eq("organization_id", ctx.orgId);

  if (error) throw error;

  await logEvent({
    actorId: ctx.actorId,
    action: "entity.deleted",
    entityType: "entity",
    entityId,
    organizationId: ctx.orgId,
    metadata: { forced: Boolean(options.force) }
  });
}

export async function addIdentifier(
  ctx: ServiceContext,
  entityId: string,
  input: { kind: string; value: string }
): Promise<EntityIdentifier> {
  await fetchEntity(ctx, entityId);
  const normalized = normalizeIdentifier(input.kind, input.value);

  const { data, error } = await ctx.db
    .from("entity_identifiers")
    .insert({
      organization_id: ctx.orgId,
      entity_id: entityId,
      kind: input.kind,
      value: input.value,
      normalized
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new ConflictError(`Identifier "${input.value}" is already used by another entity`);
    }
    throw error;
  }

  return data;
}

export async function removeIdentifier(ctx: ServiceContext, identifierId: string): Promise<void> {
  const { error } = await ctx.db
    .from("entity_identifiers")
    .delete()
    .eq("id", identifierId)
    .eq("organization_id", ctx.orgId);

  if (error) throw error;
}
