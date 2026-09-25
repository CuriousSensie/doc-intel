import type { OwnedObjectPermissions, PaperlessClient } from "@/lib/paperless/client";
import { paperlessFor } from "@/lib/paperless/client";
import {
  createPaperlessCustomField,
  createPaperlessDocumentType,
  createPaperlessTag,
  deletePaperlessCustomField,
  deletePaperlessDocumentType,
  deletePaperlessTag,
  listPaperlessDocumentTypes,
  listPaperlessTags,
  toDocumentTypeKey,
  updatePaperlessCustomField,
  updatePaperlessDocumentType,
  updatePaperlessTag,
  type PaperlessMatchingFields
} from "@/lib/paperless/documents";
import { invalidateCachedMetadataList } from "@/lib/paperless/metadata-cache";
import { NotFoundError } from "@/lib/errors";
import type { ServiceContext } from "@/lib/service-context";
import {
  createCustomFieldDef,
  deleteCustomFieldDef,
  getCustomFieldDef,
  listCustomFieldDefs,
  updateCustomFieldDef,
  type CustomFieldDataType,
  type CustomFieldDef,
  type CustomFieldSelectOption
} from "@/modules/custom-fields/custom-field-defs.service";

import {
  matchingAlgorithmToPaperless,
  paperlessToMatchingAlgorithm,
  type AttributeKind,
  type MatchingAlgorithm
} from "./attributes.schemas";

export type AttributeRow = {
  id: string;
  numericId?: number;
  kind: AttributeKind;
  name: string;
  color?: string;
  textColor?: string;
  documentCount: number;
  match: string;
  matchingAlgorithm: MatchingAlgorithm;
  viewDocumentsHref: string;
  canViewDocuments: boolean;
  // custom-fields kind only
  dataType?: CustomFieldDataType;
  options?: CustomFieldSelectOption[];
  appliesTo?: string[];
  isRequired?: boolean;
};

export type AttributeInput = {
  name: string;
  color?: string;
  match?: string;
  matchingAlgorithm: MatchingAlgorithm;
  // custom-fields kind only
  dataType?: CustomFieldDataType;
  options?: string[]; // plain labels from the form textarea, one per line
  appliesTo?: string[];
  isRequired?: boolean;
};

function toMatchingFields(input: AttributeInput): PaperlessMatchingFields {
  return {
    match: input.match?.trim() ?? "",
    matching_algorithm: matchingAlgorithmToPaperless[input.matchingAlgorithm],
    is_insensitive: true
  };
}

function requireOwnership(client: PaperlessClient): OwnedObjectPermissions {
  const ownership = client.ownership;
  if (!ownership) throw new Error("Expected tenant Paperless ownership");
  return ownership;
}

function toCustomFieldKey(name: string): string {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);

  return /^[a-z]/.test(key) ? key : `field_${key || "custom"}`;
}

function fromPaperlessMatch(value: number | undefined): MatchingAlgorithm {
  return paperlessToMatchingAlgorithm.get(value ?? 0) ?? "none";
}

export async function listAttributes(ctx: ServiceContext, kind: AttributeKind): Promise<AttributeRow[]> {
  if (kind === "custom-fields") {
    const fields = await listCustomFieldDefs(ctx);
    return fields.map((field) => ({
      id: field.id,
      kind,
      name: field.label,
      documentCount: 0,
      match: "",
      matchingAlgorithm: "none",
      viewDocumentsHref: "",
      canViewDocuments: false,
      dataType: field.data_type,
      options: (field.options as CustomFieldSelectOption[] | null) ?? [],
      appliesTo: field.applies_to,
      isRequired: field.is_required
    }));
  }

  const client = await paperlessFor(ctx.orgId);

  if (kind === "tags") {
    const tags = await listPaperlessTags(client);
    return tags.map((tag) => ({
      id: String(tag.id),
      numericId: tag.id,
      kind,
      name: tag.name,
      color: tag.color,
      textColor: tag.text_color,
      documentCount: tag.document_count ?? 0,
      match: tag.match ?? "",
      matchingAlgorithm: fromPaperlessMatch(tag.matching_algorithm),
      viewDocumentsHref: `/dashboard/documents?tagIds=${tag.id}`,
      canViewDocuments: true
    }));
  }

  const documentTypes = await listPaperlessDocumentTypes(client);
  return documentTypes.map((documentType) => ({
    id: String(documentType.id),
    numericId: documentType.id,
    kind,
    name: documentType.name,
    documentCount: documentType.document_count ?? 0,
    match: documentType.match ?? "",
    matchingAlgorithm: fromPaperlessMatch(documentType.matching_algorithm),
    viewDocumentsHref: `/dashboard/documents?documentTypeKey=${toDocumentTypeKey(documentType.name)}`,
    canViewDocuments: true
  }));
}

export async function createAttribute(
  ctx: ServiceContext,
  kind: AttributeKind,
  input: AttributeInput
): Promise<CustomFieldDef | void> {
  if (kind === "custom-fields") {
    const dataType = input.dataType ?? "string";

    const client = await paperlessFor(ctx.orgId);
    const ownership = requireOwnership(client);
    const created = await createPaperlessCustomField(
      client,
      {
        name: input.name,
        data_type: dataType,
        ...(dataType === "select"
          ? { extra_data: { select_options: (input.options ?? []).map((label) => ({ label })) } }
          : {})
      },
      ownership
    );
    const paperlessCustomFieldId = created.id;
    const options = created.extra_data?.select_options;

    return createCustomFieldDef(ctx, {
      key: toCustomFieldKey(input.name),
      label: input.name,
      dataType,
      options,
      appliesTo: input.appliesTo ?? [],
      paperlessCustomFieldId,
      isRequired: input.isRequired ?? false
    });
  }

  const client = await paperlessFor(ctx.orgId);
  const ownership = requireOwnership(client);
  const matching = toMatchingFields(input);

  if (kind === "tags") {
    await createPaperlessTag(client, input.name, ownership, input.color, matching);
    await invalidateCachedMetadataList(ctx.orgId, "tags");
    return;
  }

  await createPaperlessDocumentType(client, input.name, ownership, matching);
  await invalidateCachedMetadataList(ctx.orgId, "document_types");
}

export async function updateAttribute(
  ctx: ServiceContext,
  kind: AttributeKind,
  id: string,
  input: AttributeInput
): Promise<void> {
  if (kind === "custom-fields") {
    const def = await getCustomFieldDef(ctx, id);

    // key/data_type stay immutable (updateCustomFieldDef's own rule) — options only meaningful
    // for select. Match by label text (not position) against the existing options so an
    // unchanged option keeps its Paperless-assigned id — any document value already referencing
    // that id must keep matching it. A label with no existing match is a genuinely new option
    // and goes through with no id; Paperless assigns one on save. Renaming a label is
    // indistinguishable from remove-old+add-new at this textarea-level granularity — a known,
    // accepted limitation of the plain-textarea editor, not a bug.
    const existingOptions = (def.options as CustomFieldSelectOption[] | null) ?? [];
    const requestedOptions =
      def.data_type === "select" && input.options
        ? input.options.map((label) => existingOptions.find((o) => o.label === label) ?? { label })
        : undefined;

    // Paperless-side update (name + options) happens first — it's the one that assigns real
    // ids to brand-new options, and our own def must store exactly what Paperless ends up with,
    // never a guess.
    let resolvedOptions = requestedOptions as CustomFieldSelectOption[] | undefined;
    if (def.paperless_custom_field_id) {
      const client = await paperlessFor(ctx.orgId);
      const updated = await updatePaperlessCustomField(client, def.paperless_custom_field_id, {
        name: input.name,
        ...(requestedOptions ? { extra_data: { select_options: requestedOptions } } : {})
      });
      if (requestedOptions) resolvedOptions = updated.extra_data?.select_options;
    }

    await updateCustomFieldDef(ctx, id, {
      label: input.name,
      options: resolvedOptions,
      appliesTo: input.appliesTo,
      isRequired: input.isRequired
    });
    return;
  }

  const client = await paperlessFor(ctx.orgId);
  const numericId = Number(id);
  const matching = toMatchingFields(input);

  if (kind === "tags") {
    await updatePaperlessTag(client, numericId, {
      name: input.name,
      color: input.color,
      ...matching
    });
    await invalidateCachedMetadataList(ctx.orgId, "tags");
    return;
  }

  await updatePaperlessDocumentType(client, numericId, { name: input.name, ...matching });
  await invalidateCachedMetadataList(ctx.orgId, "document_types");
}

export async function deleteAttribute(
  ctx: ServiceContext,
  kind: AttributeKind,
  id: string
): Promise<void> {
  if (kind === "custom-fields") {
    const def = await getCustomFieldDef(ctx, id);
    if (def.paperless_custom_field_id) {
      const client = await paperlessFor(ctx.orgId);
      try {
        await deletePaperlessCustomField(client, def.paperless_custom_field_id);
      } catch (err) {
        // Tolerate "already gone" the same way undoBulkConnectAction tolerates an
        // already-deleted connection — never block our own def delete on Paperless-side drift.
        // errors.ts maps a Paperless 404 to NotFoundError.
        if (!(err instanceof NotFoundError)) throw err;
      }
    }
    await deleteCustomFieldDef(ctx, id);
    return;
  }

  const client = await paperlessFor(ctx.orgId);
  const numericId = Number(id);

  if (kind === "tags") {
    await deletePaperlessTag(client, numericId);
    await invalidateCachedMetadataList(ctx.orgId, "tags");
    return;
  }

  await deletePaperlessDocumentType(client, numericId);
  await invalidateCachedMetadataList(ctx.orgId, "document_types");
}
