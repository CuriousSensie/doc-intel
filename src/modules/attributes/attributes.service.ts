import type { OwnedObjectPermissions, PaperlessClient } from "@/lib/paperless/client";
import { paperlessFor } from "@/lib/paperless/client";
import {
  createPaperlessCorrespondent,
  createPaperlessDocumentType,
  createPaperlessTag,
  deletePaperlessCorrespondent,
  deletePaperlessDocumentType,
  deletePaperlessTag,
  listPaperlessCorrespondents,
  listPaperlessDocumentTypes,
  listPaperlessTags,
  toDocumentTypeKey,
  updatePaperlessCorrespondent,
  updatePaperlessDocumentType,
  updatePaperlessTag,
  type PaperlessMatchingFields
} from "@/lib/paperless/documents";
import { invalidateCachedMetadataList } from "@/lib/paperless/metadata-cache";
import type { ServiceContext } from "@/lib/service-context";
import {
  createCustomFieldDef,
  deleteCustomFieldDef,
  listCustomFieldDefs,
  updateCustomFieldDef
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
};

export type AttributeInput = {
  name: string;
  color?: string;
  match?: string;
  matchingAlgorithm: MatchingAlgorithm;
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
      viewDocumentsHref: "/dashboard/documents",
      canViewDocuments: false
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

  if (kind === "correspondents") {
    const correspondents = await listPaperlessCorrespondents(client);
    return correspondents.map((correspondent) => ({
      id: String(correspondent.id),
      numericId: correspondent.id,
      kind,
      name: correspondent.name,
      documentCount: correspondent.document_count ?? 0,
      match: correspondent.match ?? "",
      matchingAlgorithm: fromPaperlessMatch(correspondent.matching_algorithm),
      viewDocumentsHref: `/dashboard/documents?correspondentId=${correspondent.id}`,
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
): Promise<void> {
  if (kind === "custom-fields") {
    await createCustomFieldDef(ctx, {
      key: toCustomFieldKey(input.name),
      label: input.name,
      dataType: "string",
      appliesTo: [],
      isRequired: false
    });
    return;
  }

  const client = await paperlessFor(ctx.orgId);
  const ownership = requireOwnership(client);
  const matching = toMatchingFields(input);

  if (kind === "tags") {
    await createPaperlessTag(client, input.name, ownership, input.color, matching);
    await invalidateCachedMetadataList(ctx.orgId, "tags");
    return;
  }

  if (kind === "correspondents") {
    await createPaperlessCorrespondent(client, input.name, ownership, matching);
    await invalidateCachedMetadataList(ctx.orgId, "correspondents");
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
    await updateCustomFieldDef(ctx, id, { label: input.name });
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

  if (kind === "correspondents") {
    await updatePaperlessCorrespondent(client, numericId, { name: input.name, ...matching });
    await invalidateCachedMetadataList(ctx.orgId, "correspondents");
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

  if (kind === "correspondents") {
    await deletePaperlessCorrespondent(client, numericId);
    await invalidateCachedMetadataList(ctx.orgId, "correspondents");
    return;
  }

  await deletePaperlessDocumentType(client, numericId);
  await invalidateCachedMetadataList(ctx.orgId, "document_types");
}
