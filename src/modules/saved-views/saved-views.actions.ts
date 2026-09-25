"use server";

import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import {
  createSavedViewSchema,
  renameSavedViewSchema
} from "@/modules/saved-views/saved-views.schemas";
import {
  createSavedView,
  deleteSavedView,
  ensureStarterViews,
  getSavedView,
  listSavedViews,
  renameSavedView
} from "@/modules/saved-views/saved-views.service";

export async function listSavedViewsAction() {
  requireFeature("documents");
  const ctx = await buildRequestContext();
  return listSavedViews(ctx);
}

export async function ensureStarterViewsAction() {
  requireFeature("documents");
  const ctx = await buildRequestContext();
  return ensureStarterViews(ctx);
}

export async function createSavedViewAction(input: unknown) {
  requireFeature("documents");
  const parsed = createSavedViewSchema.parse(input);
  const ctx = await buildRequestContext();
  return createSavedView(ctx, parsed);
}

export async function getSavedViewAction(id: string) {
  requireFeature("documents");
  const ctx = await buildRequestContext();
  return getSavedView(ctx, id);
}

export async function renameSavedViewAction(input: unknown) {
  requireFeature("documents");
  const parsed = renameSavedViewSchema.parse(input);
  const ctx = await buildRequestContext();
  return renameSavedView(ctx, parsed.id, parsed.name);
}

export async function deleteSavedViewAction(id: string) {
  requireFeature("documents");
  const ctx = await buildRequestContext();
  return deleteSavedView(ctx, id);
}
