import { ConflictError, NotFoundError } from "@/lib/errors";
import { logEvent } from "@/lib/events";
import {
  assertLosslessTypeChange,
  fieldSchemaArraySchema,
  type EntityFieldDefinition,
  type EntityFieldType
} from "@/modules/entities/field-schema";
import type { ServiceContext } from "@/lib/service-context";
import type { Database } from "@/types/database";

export type EntityType = Database["public"]["Tables"]["entity_types"]["Row"];

const UNIQUE_VIOLATION = "23505";

function parseFieldSchema(entityType: EntityType): EntityFieldDefinition[] {
  return fieldSchemaArraySchema.parse(entityType.field_schema ?? []);
}

async function fetchEntityType(ctx: ServiceContext, entityTypeId: string): Promise<EntityType> {
  const { data, error } = await ctx.db
    .from("entity_types")
    .select("*")
    .eq("id", entityTypeId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NotFoundError("Entity type not found");
  return data;
}

export async function listEntityTypes(ctx: ServiceContext): Promise<EntityType[]> {
  const { data, error } = await ctx.db
    .from("entity_types")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .order("name", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getEntityType(ctx: ServiceContext, entityTypeId: string): Promise<EntityType> {
  return fetchEntityType(ctx, entityTypeId);
}

export async function createEntityType(
  ctx: ServiceContext,
  input: { key: string; name: string; namePlural: string; icon?: string; fieldSchema?: EntityFieldDefinition[] }
): Promise<EntityType> {
  const fieldSchema = fieldSchemaArraySchema.parse(input.fieldSchema ?? []);

  const { data, error } = await ctx.db
    .from("entity_types")
    .insert({
      organization_id: ctx.orgId,
      key: input.key,
      name: input.name,
      name_plural: input.namePlural,
      icon: input.icon ?? null,
      is_system: false,
      field_schema: fieldSchema
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new ConflictError(`An entity type with key "${input.key}" already exists`);
    }
    throw error;
  }

  await logEvent({
    actorId: ctx.actorId,
    action: "entity_type.created",
    entityType: "entity_type",
    entityId: data.id,
    organizationId: ctx.orgId,
    metadata: { key: input.key }
  });

  return data;
}

// name/name_plural/icon only — key is immutable by design (specs/05 §Schema evolution rules:
// "Changing a key: forbidden"), field_schema changes go through the field-level functions below.
export async function updateEntityTypeMeta(
  ctx: ServiceContext,
  entityTypeId: string,
  input: { name?: string; namePlural?: string; icon?: string | null }
): Promise<EntityType> {
  await fetchEntityType(ctx, entityTypeId);

  const { data, error } = await ctx.db
    .from("entity_types")
    .update({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.namePlural !== undefined ? { name_plural: input.namePlural } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {})
    })
    .eq("id", entityTypeId)
    .eq("organization_id", ctx.orgId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

async function writeFieldSchema(
  ctx: ServiceContext,
  entityTypeId: string,
  fieldSchema: EntityFieldDefinition[]
): Promise<EntityType> {
  const { data, error } = await ctx.db
    .from("entity_types")
    .update({ field_schema: fieldSchema })
    .eq("id", entityTypeId)
    .eq("organization_id", ctx.orgId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

// specs/05 §Schema evolution rules: "Adding a field: safe, always allowed."
export async function addField(
  ctx: ServiceContext,
  entityTypeId: string,
  field: EntityFieldDefinition
): Promise<EntityType> {
  const entityType = await fetchEntityType(ctx, entityTypeId);
  const fieldSchema = parseFieldSchema(entityType);

  if (fieldSchema.some((existing) => existing.key === field.key)) {
    throw new ConflictError(`Field "${field.key}" already exists on this entity type`);
  }

  const updated = await writeFieldSchema(ctx, entityTypeId, [...fieldSchema, field]);

  await logEvent({
    actorId: ctx.actorId,
    action: "entity_type.field_added",
    entityType: "entity_type",
    entityId: entityTypeId,
    organizationId: ctx.orgId,
    metadata: { key: field.key, type: field.type }
  });

  return updated;
}

// specs/05 §Schema evolution rules: "Renaming a label: safe."
export async function renameFieldLabel(
  ctx: ServiceContext,
  entityTypeId: string,
  fieldKey: string,
  label: string
): Promise<EntityType> {
  const entityType = await fetchEntityType(ctx, entityTypeId);
  const fieldSchema = parseFieldSchema(entityType);
  const field = fieldSchema.find((f) => f.key === fieldKey);

  if (!field) throw new NotFoundError(`Field "${fieldKey}" not found on this entity type`);

  const next = fieldSchema.map((f) => (f.key === fieldKey ? { ...f, label } : f));
  return writeFieldSchema(ctx, entityTypeId, next);
}

// specs/05 §Schema evolution rules: "Changing a type: allowed only where lossless
// (string→text); otherwise blocked with a clear message."
export async function changeFieldType(
  ctx: ServiceContext,
  entityTypeId: string,
  fieldKey: string,
  type: EntityFieldType
): Promise<EntityType> {
  const entityType = await fetchEntityType(ctx, entityTypeId);
  const fieldSchema = parseFieldSchema(entityType);
  const field = fieldSchema.find((f) => f.key === fieldKey);

  if (!field) throw new NotFoundError(`Field "${fieldKey}" not found on this entity type`);

  assertLosslessTypeChange(field.type, type);

  const next = fieldSchema.map((f) => (f.key === fieldKey ? { ...f, type } : f));
  return writeFieldSchema(ctx, entityTypeId, next);
}

// specs/05 §Schema evolution rules: "Removing a field: soft — hidden from UI, data retained in
// `data` jsonb for 90 days." Never removed from field_schema by application code — a physical
// purge after the retention window is a Phase 5/cron concern, not this function's job.
export async function removeField(
  ctx: ServiceContext,
  entityTypeId: string,
  fieldKey: string
): Promise<EntityType> {
  const entityType = await fetchEntityType(ctx, entityTypeId);
  const fieldSchema = parseFieldSchema(entityType);

  if (!fieldSchema.some((f) => f.key === fieldKey)) {
    throw new NotFoundError(`Field "${fieldKey}" not found on this entity type`);
  }

  const next = fieldSchema.map((f) => (f.key === fieldKey ? { ...f, hidden: true } : f));
  return writeFieldSchema(ctx, entityTypeId, next);
}

export function getVisibleFieldSchema(entityType: EntityType): EntityFieldDefinition[] {
  return parseFieldSchema(entityType).filter((field) => !field.hidden);
}

export function getFieldSchema(entityType: EntityType): EntityFieldDefinition[] {
  return parseFieldSchema(entityType);
}
