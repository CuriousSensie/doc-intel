"use server";

import { getLocale, getTranslations } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import { withStatus } from "@/modules/auth/redirects";
import {
  addField,
  changeFieldType,
  createEntityType,
  getEntityType,
  getEntityTypeByKey,
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

type Translator = Awaited<ReturnType<typeof getTranslations>>;

function redirectWithError(path: string, error: unknown, t: Translator, locale: Locale): never {
  const message = error instanceof Error ? error.message : t("actions.somethingWentWrong");
  return redirect({ href: withStatus(path, "error", message), locale });
}

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

export async function getEntityTypeByKeyAction(key: string) {
  requireFeature("entities");
  const ctx = await buildRequestContext();
  return getEntityTypeByKey(ctx, key);
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

// Plain-form variants (native <form action>, redirect on completion) for the entity-types admin
// page — matches this codebase's existing form convention (e.g. settings/team) rather than
// introducing a client-side dialog pattern for a first, simple pass at this UI.

export async function createEntityTypeFormAction(formData: FormData) {
  requireFeature("entities");
  const ctx = await buildRequestContext();
  const [t, locale] = await Promise.all([getTranslations("entityTypes"), getLocale()]);

  try {
    const parsed = createEntityTypeSchema.parse({
      key: formData.get("key"),
      name: formData.get("name"),
      namePlural: formData.get("namePlural")
    });
    await createEntityType(ctx, parsed);
  } catch (error) {
    redirectWithError("/dashboard/entity-types", error, t, locale);
  }

  // See createEntityFormAction's comment (src/modules/entities/entities.actions.ts) — a bare
  // redirect back to the same page doesn't change the URL, so Next.js won't refetch stale data.
  return redirect({ href: withStatus("/dashboard/entity-types", "message", t("actions.created")), locale });
}

export async function addFieldFormAction(formData: FormData) {
  requireFeature("entities");
  const ctx = await buildRequestContext();
  const [t, locale] = await Promise.all([getTranslations("entityTypes"), getLocale()]);
  const entityTypeId = String(formData.get("entityTypeId"));

  try {
    const parsed = addFieldSchema.parse({
      key: formData.get("key"),
      label: formData.get("label"),
      type: formData.get("type"),
      required: formData.get("required") === "on"
    });
    await addField(ctx, entityTypeId, parsed);
  } catch (error) {
    redirectWithError(`/dashboard/entity-types/${entityTypeId}`, error, t, locale);
  }

  return redirect({
    href: withStatus(`/dashboard/entity-types/${entityTypeId}`, "message", t("actions.fieldAdded")),
    locale
  });
}

export async function removeFieldFormAction(formData: FormData) {
  requireFeature("entities");
  const ctx = await buildRequestContext();
  const [t, locale] = await Promise.all([getTranslations("entityTypes"), getLocale()]);
  const entityTypeId = String(formData.get("entityTypeId"));

  try {
    const parsed = removeFieldSchema.parse({ fieldKey: formData.get("fieldKey") });
    await removeField(ctx, entityTypeId, parsed.fieldKey);
  } catch (error) {
    redirectWithError(`/dashboard/entity-types/${entityTypeId}`, error, t, locale);
  }

  return redirect({
    href: withStatus(`/dashboard/entity-types/${entityTypeId}`, "message", t("actions.fieldHidden")),
    locale
  });
}
