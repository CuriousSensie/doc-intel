"use server";

import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import {
  createCustomFieldDefSchema,
  updateCustomFieldDefSchema
} from "@/modules/custom-fields/custom-field-defs.schemas";
import {
  createCustomFieldDef,
  deleteCustomFieldDef,
  listCustomFieldDefs,
  updateCustomFieldDef
} from "@/modules/custom-fields/custom-field-defs.service";

export async function listCustomFieldDefsAction() {
  requireFeature("documents");
  const ctx = await buildRequestContext();
  return listCustomFieldDefs(ctx);
}

export async function createCustomFieldDefAction(input: unknown) {
  requireFeature("documents");
  const parsed = createCustomFieldDefSchema.parse(input);
  const ctx = await buildRequestContext();
  return createCustomFieldDef(ctx, parsed);
}

export async function updateCustomFieldDefAction(id: string, input: unknown) {
  requireFeature("documents");
  const parsed = updateCustomFieldDefSchema.parse(input);
  const ctx = await buildRequestContext();
  return updateCustomFieldDef(ctx, id, parsed);
}

export async function deleteCustomFieldDefAction(id: string) {
  requireFeature("documents");
  const ctx = await buildRequestContext();
  return deleteCustomFieldDef(ctx, id);
}
