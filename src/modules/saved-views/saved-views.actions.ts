"use server";

import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import { createSavedViewSchema } from "@/modules/saved-views/saved-views.schemas";
import {
  createSavedView,
  deleteSavedView,
  ensureStarterViews,
  listSavedViews
} from "@/modules/saved-views/saved-views.service";

export async function listSavedViewsAction() {
  requireFeature("entities");
  const ctx = await buildRequestContext();
  return listSavedViews(ctx);
}

export async function ensureStarterViewsAction() {
  requireFeature("entities");
  const ctx = await buildRequestContext();
  return ensureStarterViews(ctx);
}

export async function createSavedViewAction(input: unknown) {
  requireFeature("entities");
  const parsed = createSavedViewSchema.parse(input);
  const ctx = await buildRequestContext();
  return createSavedView(ctx, parsed);
}

export async function deleteSavedViewAction(id: string) {
  requireFeature("entities");
  const ctx = await buildRequestContext();
  return deleteSavedView(ctx, id);
}
