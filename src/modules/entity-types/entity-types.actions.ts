"use server";

import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import {
  addField,
  changeFieldType,
  createEntityType,
  getEntityType,
  listEntityTypes,
  removeField,
  renameFieldLabel,
  updateEntityTypeMeta
} from "@/modules/entity-types/entity-types.service";
import {
  addFieldSchema,
  changeFieldTypeSchema,
  createEntityTypeSchema,
  removeFieldSchema,
  renameFieldLabelSchema,
  updateEntityTypeMetaSchema
} from "@/modules/entity-types/entity-types.schemas";

export async function listEntityTypesAction() {
  requireFeature("entities");
  const ctx = await buildRequestContext();
  return listEntityTypes(ctx);
}

export async function getEntityTypeAction(entityTypeId: string) {
  requireFeature("entities");
  const ctx = await buildRequestContext();
  return getEntityType(ctx, entityTypeId);
}

export async function createEntityTypeAction(input: unknown) {
  requireFeature("entities");
  const parsed = createEntityTypeSchema.parse(input);
  const ctx = await buildRequestContext();
  return createEntityType(ctx, parsed);
}

export async function updateEntityTypeMetaAction(entityTypeId: string, input: unknown) {
  requireFeature("entities");
  const parsed = updateEntityTypeMetaSchema.parse(input);
  const ctx = await buildRequestContext();
  return updateEntityTypeMeta(ctx, entityTypeId, parsed);
}

export async function addFieldAction(entityTypeId: string, input: unknown) {
  requireFeature("entities");
  const parsed = addFieldSchema.parse(input);
  const ctx = await buildRequestContext();
  return addField(ctx, entityTypeId, parsed);
}

export async function renameFieldLabelAction(entityTypeId: string, input: unknown) {
  requireFeature("entities");
  const parsed = renameFieldLabelSchema.parse(input);
  const ctx = await buildRequestContext();
  return renameFieldLabel(ctx, entityTypeId, parsed.fieldKey, parsed.label);
}

export async function changeFieldTypeAction(entityTypeId: string, input: unknown) {
  requireFeature("entities");
  const parsed = changeFieldTypeSchema.parse(input);
  const ctx = await buildRequestContext();
  return changeFieldType(ctx, entityTypeId, parsed.fieldKey, parsed.type);
}

export async function removeFieldAction(entityTypeId: string, input: unknown) {
  requireFeature("entities");
  const parsed = removeFieldSchema.parse(input);
  const ctx = await buildRequestContext();
  return removeField(ctx, entityTypeId, parsed.fieldKey);
}
