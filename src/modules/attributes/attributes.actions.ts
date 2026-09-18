"use server";

import { getLocale, getTranslations } from "next-intl/server";
import { ZodError } from "zod";

import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import { withStatus } from "@/modules/auth/redirects";

import { attributeFormSchema, deleteAttributeSchema, parseAttributeOptionsInput } from "./attributes.schemas";
import { createAttribute, deleteAttribute, updateAttribute } from "./attributes.service";

type Translator = Awaited<ReturnType<typeof getTranslations>>;

function requireAttributeFeature(kind: string): void {
  requireFeature(kind === "custom-fields" ? "entities" : "documents");
}

function redirectWithError(path: string, error: unknown, t: Translator, locale: Locale): never {
  const message =
    error instanceof ZodError
      ? error.issues.map((issue) => issue.message).join("; ")
      : error instanceof Error
        ? error.message
        : t("actions.somethingWentWrong");
  return redirect({ href: withStatus(path, "error", message), locale });
}

function listPath(kind: string): string {
  return `/dashboard/attributes/${kind}`;
}

export async function saveAttributeFormAction(formData: FormData) {
  const rawKind = String(formData.get("kind") ?? "");
  requireAttributeFeature(rawKind);
  const [ctx, t, locale] = await Promise.all([
    buildRequestContext(),
    getTranslations("common.attributes"),
    getLocale()
  ]);

  let kind = rawKind;
  try {
    const parsed = attributeFormSchema.parse({
      id: formData.get("id") || undefined,
      kind: rawKind,
      name: formData.get("name"),
      color: formData.get("color") || undefined,
      matchingAlgorithm: formData.get("matchingAlgorithm") || undefined,
      match: formData.get("match") || undefined,
      dataType: formData.get("dataType") || undefined,
      options: formData.getAll("options").map(String),
      appliesTo: formData.getAll("appliesTo").map(String),
      isRequired: false
    });
    kind = parsed.kind;
    const input = {
      name: parsed.name,
      color: parsed.color || undefined,
      matchingAlgorithm: parsed.matchingAlgorithm,
      match: parsed.match || "",
      dataType: parsed.dataType,
      options: parseAttributeOptionsInput(parsed.options),
      appliesTo: parsed.appliesTo,
      isRequired: parsed.isRequired
    };

    if (parsed.id) {
      await updateAttribute(ctx, parsed.kind, parsed.id, input);
    } else {
      await createAttribute(ctx, parsed.kind, input);
    }
  } catch (error) {
    redirectWithError(listPath(kind), error, t, locale);
  }

  const key = formData.get("id") ? "actions.saved" : "actions.created";
  return redirect({ href: withStatus(listPath(kind), "message", t(key)), locale });
}

export async function deleteAttributeFormAction(formData: FormData) {
  const rawKind = String(formData.get("kind") ?? "");
  requireAttributeFeature(rawKind);
  const [ctx, t, locale] = await Promise.all([
    buildRequestContext(),
    getTranslations("common.attributes"),
    getLocale()
  ]);

  let kind = rawKind;
  try {
    const parsed = deleteAttributeSchema.parse({
      kind: rawKind,
      id: formData.get("id")
    });
    kind = parsed.kind;
    await deleteAttribute(ctx, parsed.kind, parsed.id);
  } catch (error) {
    redirectWithError(listPath(kind), error, t, locale);
  }

  return redirect({ href: withStatus(listPath(kind), "message", t("actions.deleted")), locale });
}
