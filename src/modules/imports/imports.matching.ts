import type { ServiceContext } from "@/lib/service-context";
import { ImportRowError, type ImportErrorCode } from "@/lib/import/errors";
import { parseLocaleDate, parseLocaleNumber, type DateFormat } from "@/lib/import/locale";
import {
  getEntityTypeByKey,
  getVisibleFieldSchema
} from "@/modules/entity-types/entity-types.service";
import type { EntityFieldDefinition, EntityFieldType } from "@/modules/entities/field-schema";
import { normalizeIdentifier } from "@/modules/entities/identifier-normalization";
import type { Relation } from "@/modules/connections/connections.service";

import type {
  DocumentFieldMapping,
  DocumentImportMapping,
  EntityImportMapping,
  EntityLinkMapping,
  MetadataOnlyImportMapping
} from "./imports.schemas";
import type { ZipEntryInfo } from "@/lib/import/parse";

export type RawImportRow = { rowNumber: number; raw: string[] };

// The one place a mapped cell's raw string becomes a typed value — entity fields and document
// custom-field mappings both funnel through this, so sl-SI parsing (Phase 3 M4) never has a
// second, slightly different implementation.
export function parseFieldValue(
  raw: string,
  type: EntityFieldType,
  options: { dateFormat?: DateFormat; decimalSeparator?: "," | "." } = {}
): string | number | boolean {
  const trimmed = raw.trim();

  switch (type) {
    case "integer": {
      const value = parseLocaleNumber(trimmed, options.decimalSeparator ?? ",");
      if (!Number.isInteger(value)) {
        throw new ImportRowError("INVALID_NUMBER", `"${raw}" is not a whole number`);
      }
      return value;
    }
    case "decimal":
    case "monetary":
      return parseLocaleNumber(trimmed, options.decimalSeparator ?? ",");
    case "date":
      return parseLocaleDate(trimmed, options.dateFormat ?? "dd.MM.yyyy");
    case "boolean":
      if (/^(1|true|yes|da)$/i.test(trimmed)) return true;
      if (/^(0|false|no|ne)$/i.test(trimmed)) return false;
      throw new ImportRowError("INVALID_NUMBER", `"${raw}" is not a recognizable boolean`);
    case "string":
    case "text":
    default:
      return trimmed;
  }
}

// ===============================================================================================
// kind: "entities"
// ===============================================================================================

export type EntityRowPlan =
  | {
      action: "create";
      entityTypeId: string;
      displayName: string;
      data: Record<string, unknown>;
    }
  | {
      action: "update";
      entityId: string;
      entityTypeId: string;
      displayName: string;
      data: Record<string, unknown>;
    }
  | { action: "error"; code: ImportErrorCode; message: string };

function identifierMapKey(kind: string, normalized: string): string {
  return `${kind}::${normalized}`;
}

// Batches every identifier lookup a chunk needs into one query per distinct identifier kind
// (not one query per row) — specs/06-importer.md's "identifier | Normalized lookup ... the
// primary path" is the expensive part; this is what keeps it O(kinds), not O(rows).
export async function resolveEntityRowPlans(
  ctx: ServiceContext,
  mapping: EntityImportMapping,
  rows: RawImportRow[]
): Promise<Map<number, EntityRowPlan>> {
  const entityType = await getEntityTypeByKey(ctx, mapping.entityTypeKey);
  const fieldSchema = getVisibleFieldSchema(entityType);
  const plans = new Map<number, EntityRowPlan>();

  // Row-level: normalize every configured identifier column, tracking parse failures per row
  // so they still get a plan (an error one) rather than being silently skipped from lookup.
  const normalizedByRow = new Map<number, Array<{ kind: string; normalized: string }>>();
  const distinctByKind = new Map<string, Set<string>>();

  for (const row of rows) {
    const normalized: Array<{ kind: string; normalized: string }> = [];
    for (const idCol of mapping.identifierColumns) {
      const raw = row.raw[idCol.column]?.trim();
      if (!raw) continue;
      const value = normalizeIdentifier(idCol.kind, raw);
      normalized.push({ kind: idCol.kind, normalized: value });
      if (!distinctByKind.has(idCol.kind)) distinctByKind.set(idCol.kind, new Set());
      distinctByKind.get(idCol.kind)!.add(value);
    }
    normalizedByRow.set(row.rowNumber, normalized);
  }

  const matchesByKey = new Map<string, string>(); // "kind::normalized" -> entity_id
  await Promise.all(
    [...distinctByKind.entries()].map(async ([kind, values]) => {
      if (values.size === 0) return;
      const { data, error } = await ctx.db
        .from("entity_identifiers")
        .select("entity_id, normalized")
        .eq("organization_id", ctx.orgId)
        .eq("kind", kind)
        .in("normalized", [...values]);
      if (error) throw error;
      for (const row of data ?? []) {
        matchesByKey.set(identifierMapKey(kind, row.normalized), row.entity_id);
      }
    })
  );

  for (const row of rows) {
    const displayName = row.raw[mapping.displayNameColumn]?.trim();
    if (!displayName) {
      plans.set(row.rowNumber, {
        action: "error",
        code: "MISSING_REQUIRED",
        message: "Display name column is empty"
      });
      continue;
    }

    try {
      const data = resolveEntityFieldData(mapping, fieldSchema, row.raw);

      const normalized = normalizedByRow.get(row.rowNumber) ?? [];
      const matchedEntityIds = new Set(
        normalized
          .map((n) => matchesByKey.get(identifierMapKey(n.kind, n.normalized)))
          .filter((id): id is string => Boolean(id))
      );

      if (matchedEntityIds.size > 1) {
        plans.set(row.rowNumber, {
          action: "error",
          code: "IDENTIFIER_CONFLICT",
          message: "Row's identifier columns match more than one existing entity"
        });
        continue;
      }

      const [existingEntityId] = matchedEntityIds;
      plans.set(
        row.rowNumber,
        existingEntityId
          ? {
              action: "update",
              entityId: existingEntityId,
              entityTypeId: entityType.id,
              displayName,
              data
            }
          : { action: "create", entityTypeId: entityType.id, displayName, data }
      );
    } catch (err) {
      plans.set(row.rowNumber, toErrorPlan(err));
    }
  }

  return plans;
}

function resolveEntityFieldData(
  mapping: EntityImportMapping,
  fieldSchema: EntityFieldDefinition[],
  raw: string[]
): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  // Identifier columns are used for matching (has this VAT been seen before?), but the value
  // must also land in the entity's own `data` under whichever field_schema key carries that
  // identifier_kind — otherwise createEntity()'s syncIdentifiersFromData() (which reads
  // data[field.key], not the mapping) has nothing to promote, and the entity comes out of the
  // import with no entity_identifiers row at all: unfindable on the next monthly re-import,
  // which is the entire point of "mappings are saved per tenant and reusable" (specs/06). Found
  // live during Phase 3 M6 verification — a unit test with a mocked identifier lookup can't
  // catch a missing row that was never expected to exist in the first place.
  for (const idCol of mapping.identifierColumns) {
    const rawValue = raw[idCol.column]?.trim();
    if (!rawValue) continue;
    const field = fieldSchema.find((f) => f.identifier_kind === idCol.kind);
    if (field) data[field.key] = rawValue;
  }

  for (const field of mapping.fields) {
    const rawValue = raw[field.column];
    if (rawValue === undefined || rawValue.trim() === "") continue;

    const definition = fieldSchema.find((f) => f.key === field.key);
    const required = definition?.required ?? false;
    try {
      data[field.key] = parseFieldValue(rawValue, field.type, {
        dateFormat: field.dateFormat,
        decimalSeparator: field.decimalSeparator
      });
    } catch (err) {
      if (required) throw err;
      // Optional field, unparseable value — drop it rather than fail the whole row over a
      // field nobody required.
    }
  }

  return data;
}

function toErrorPlan(err: unknown): { action: "error"; code: ImportErrorCode; message: string } {
  if (err instanceof ImportRowError) {
    return { action: "error", code: err.code, message: err.message };
  }
  return {
    action: "error",
    code: "UNKNOWN",
    message: err instanceof Error ? err.message : String(err)
  };
}

// ===============================================================================================
// kind: "documents" | "metadata_only"
// ===============================================================================================

export type ResolvedEntityLink =
  | { outcome: "linked"; entityId: string; relation: Relation }
  | {
      outcome: "create";
      entityTypeKey: string;
      displayName: string;
      relation: Relation;
      // Set only when matchBy was "identifier" — lets applyEntityLinks() write the same value
      // into the new entity's own data (keyed by whichever field_schema entry declares this
      // identifier_kind), so the entity it just created is actually findable by that
      // identifier on a future import instead of coming out with an empty `data` (found live
      // during Phase 3 M6 verification — the same class of gap the main entities-import path
      // had before its own fix).
      identifierKind?: string;
      identifierValue?: string;
    }
  | { outcome: "skipped"; relation: Relation }
  | { outcome: "fail_row"; message: string };

export type ResolvedFieldWrite =
  | { target: "document_date"; value: string }
  | { target: "custom_field"; key: string; value: string | number | boolean };

export type DocumentRowPlan =
  | {
      action: "create_document";
      archiveFileName: string;
      fieldWrites: ResolvedFieldWrite[];
      entityLinks: ResolvedEntityLink[];
      needsReview?: true;
      reviewCode?: ImportErrorCode;
      reviewMessage?: string;
    }
  | {
      action: "connect_existing";
      documentId: string;
      paperlessDocumentId: number;
      fieldWrites: ResolvedFieldWrite[];
      entityLinks: ResolvedEntityLink[];
      needsReview?: true;
      reviewCode?: ImportErrorCode;
      reviewMessage?: string;
    }
  | {
      // specs/06-importer.md §Duplicates: the default strategy's second clause — a skipped
      // duplicate must still apply that row's connections to the existing document.
      action: "skip_duplicate";
      documentId: string;
      entityLinks: ResolvedEntityLink[];
      needsReview?: true;
      reviewCode?: ImportErrorCode;
      reviewMessage?: string;
    }
  | { action: "error"; code: ImportErrorCode; message: string };

type DocumentMatchInput = {
  mapping: DocumentImportMapping | MetadataOnlyImportMapping;
  rows: RawImportRow[];
  archiveEntries?: ZipEntryInfo[];
};

// Batches every document/entity-link lookup a chunk needs. `archiveEntries` is only present
// for kind:"documents" with an archive source — kind:"metadata_only" has no archive, "filename"
// there matches documents.title instead (see documentByMappingSchema comment in the caller).
export async function resolveDocumentRowPlans(
  ctx: ServiceContext,
  kind: "documents" | "metadata_only",
  input: DocumentMatchInput
): Promise<Map<number, DocumentRowPlan>> {
  const { mapping, rows, archiveEntries } = input;
  const plans = new Map<number, DocumentRowPlan>();

  const documentMatches = await batchMatchDocuments(ctx, kind, mapping, rows, archiveEntries);
  const linkMatches = await batchMatchEntityLinks(ctx, mapping.entityLinks, rows);

  for (const row of rows) {
    try {
      const entityLinks = resolveEntityLinksForRow(mapping.entityLinks, row, linkMatches);
      const fieldWrites = resolveFieldWritesForRow(mapping.fields, row);
      const linkReview = reviewEntityLinks(entityLinks);
      if (linkReview?.fatal) {
        plans.set(row.rowNumber, {
          action: "error",
          code: "ENTITY_NOT_FOUND",
          message: linkReview.message
        });
        continue;
      }
      const match = documentMatches.get(row.rowNumber);

      if (kind === "metadata_only") {
        if (!match?.documentId || match.paperlessDocumentId === undefined) {
          plans.set(row.rowNumber, {
            action: "error",
            code: "DOCUMENT_NOT_FOUND",
            message: "No existing document matched this row"
          });
          continue;
        }
        plans.set(row.rowNumber, {
          action: "connect_existing",
          documentId: match.documentId,
          paperlessDocumentId: match.paperlessDocumentId,
          fieldWrites,
          entityLinks,
          ...linkReview?.planFlags
        });
        continue;
      }

      // kind === "documents": match is either an archive filename (new document) or, if the
      // strategy is checksum/paperless_id, an already-existing document (a re-import).
      const documentMapping = mapping as DocumentImportMapping;

      if (match?.documentId) {
        const strategy = documentMapping.duplicateStrategy;
        if (strategy === "fail") {
          plans.set(row.rowNumber, {
            action: "error",
            code: "DUPLICATE",
            message: "A document already exists for this row"
          });
        } else if (strategy === "create_anyway" && match.archiveFileName) {
          plans.set(row.rowNumber, {
            action: "create_document",
            archiveFileName: match.archiveFileName,
            fieldWrites,
            entityLinks,
            ...linkReview?.planFlags
          });
        } else {
          plans.set(row.rowNumber, {
            action: "skip_duplicate",
            documentId: match.documentId,
            entityLinks,
            ...linkReview?.planFlags
          });
        }
        continue;
      }

      if (!match?.archiveFileName) {
        plans.set(row.rowNumber, {
          action: "error",
          code: "FILE_MISSING_IN_ARCHIVE",
          message: "No archive file matched this row"
        });
        continue;
      }

      plans.set(row.rowNumber, {
        action: "create_document",
        archiveFileName: match.archiveFileName,
        fieldWrites,
        entityLinks,
        ...linkReview?.planFlags
      });
    } catch (err) {
      plans.set(row.rowNumber, toErrorPlan(err));
    }
  }

  return plans;
}

type DocumentMatch = {
  documentId?: string;
  paperlessDocumentId?: number;
  archiveFileName?: string;
};

async function batchMatchDocuments(
  ctx: ServiceContext,
  kind: "documents" | "metadata_only",
  mapping: DocumentImportMapping | MetadataOnlyImportMapping,
  rows: RawImportRow[],
  archiveEntries: ZipEntryInfo[] | undefined
): Promise<Map<number, DocumentMatch>> {
  const matches = new Map<number, DocumentMatch>();
  const { strategy, column } = mapping.documentBy;

  if (strategy === "filename" && kind === "documents") {
    const byName = new Map((archiveEntries ?? []).map((e) => [e.fileName, e]));
    const byLowerName = new Map((archiveEntries ?? []).map((e) => [e.fileName.toLowerCase(), e]));
    const byBaseName = new Map(
      (archiveEntries ?? []).map((e) => [basenameNoExt(e.fileName).toLowerCase(), e])
    );

    for (const row of rows) {
      const raw = row.raw[column]?.trim();
      if (!raw) continue;
      // specs/06-importer.md §Matching: "exact, then case-insensitive, then basename-without-
      // extension" — checked in that order.
      const entry =
        byName.get(raw) ??
        byLowerName.get(raw.toLowerCase()) ??
        byBaseName.get(basenameNoExt(raw).toLowerCase());
      if (entry) matches.set(row.rowNumber, { archiveFileName: entry.fileName });
    }
    return matches;
  }

  // filename against our own mirror (metadata_only, no archive), checksum, or paperless_id —
  // all batched as one .in() query against `documents`.
  const values = new Map<number, string>();
  for (const row of rows) {
    const raw = row.raw[column]?.trim();
    if (raw) values.set(row.rowNumber, raw);
  }
  if (values.size === 0) return matches;

  const distinct = [...new Set(values.values())];
  const byLookup = new Map<string, { documentId: string; paperlessDocumentId: number }>();

  if (strategy === "checksum") {
    const { data, error } = await ctx.db
      .from("documents")
      .select("id, checksum, paperless_document_id")
      .eq("organization_id", ctx.orgId)
      .is("deleted_at", null)
      .in("checksum", distinct);
    if (error) throw error;
    for (const doc of data ?? []) {
      if (doc.checksum) {
        byLookup.set(doc.checksum, {
          documentId: doc.id,
          paperlessDocumentId: doc.paperless_document_id
        });
      }
    }
  } else if (strategy === "paperless_id") {
    const numeric = distinct.map(Number).filter((n) => Number.isInteger(n));
    const { data, error } = await ctx.db
      .from("documents")
      .select("id, paperless_document_id")
      .eq("organization_id", ctx.orgId)
      .is("deleted_at", null)
      .in("paperless_document_id", numeric);
    if (error) throw error;
    for (const doc of data ?? []) {
      byLookup.set(String(doc.paperless_document_id), {
        documentId: doc.id,
        paperlessDocumentId: doc.paperless_document_id
      });
    }
  } else {
    // strategy === "filename" && kind === "metadata_only" — match against our mirror's title.
    const { data, error } = await ctx.db
      .from("documents")
      .select("id, title, paperless_document_id")
      .eq("organization_id", ctx.orgId)
      .is("deleted_at", null)
      .in("title", distinct);
    if (error) throw error;
    for (const doc of data ?? []) {
      byLookup.set(doc.title, {
        documentId: doc.id,
        paperlessDocumentId: doc.paperless_document_id
      });
    }
  }

  for (const [rowNumber, raw] of values) {
    const match = byLookup.get(raw);
    if (match) {
      matches.set(rowNumber, {
        documentId: match.documentId,
        paperlessDocumentId: match.paperlessDocumentId
      });
    }
  }

  return matches;
}

function basenameNoExt(fileName: string): string {
  const base = fileName.split("/").pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

type LinkMatchKey = string; // `${entityTypeKey}::${matchBy}::${normalizedOrValue}`

async function batchMatchEntityLinks(
  ctx: ServiceContext,
  links: EntityLinkMapping[],
  rows: RawImportRow[]
): Promise<Map<LinkMatchKey, string>> {
  const matches = new Map<LinkMatchKey, string>();
  if (links.length === 0) return matches;

  const byIdentifierKind = new Map<string, Set<string>>(); // kind -> normalized values
  const byDisplayNameType = new Map<string, Set<string>>(); // entityTypeKey -> names
  const byIdType = new Map<string, Set<string>>(); // entityTypeKey -> ids

  for (const link of links) {
    for (const row of rows) {
      const raw = row.raw[link.column]?.trim();
      if (!raw) continue;

      if (link.matchBy === "identifier" && link.identifierKind) {
        const normalized = normalizeIdentifier(link.identifierKind, raw);
        if (!byIdentifierKind.has(link.identifierKind))
          byIdentifierKind.set(link.identifierKind, new Set());
        byIdentifierKind.get(link.identifierKind)!.add(normalized);
      } else if (link.matchBy === "display_name") {
        if (!byDisplayNameType.has(link.entityTypeKey))
          byDisplayNameType.set(link.entityTypeKey, new Set());
        byDisplayNameType.get(link.entityTypeKey)!.add(raw);
      } else if (link.matchBy === "id") {
        if (!byIdType.has(link.entityTypeKey)) byIdType.set(link.entityTypeKey, new Set());
        byIdType.get(link.entityTypeKey)!.add(raw);
      }
    }
  }

  await Promise.all([
    ...[...byIdentifierKind.entries()].map(async ([kind, values]) => {
      const { data, error } = await ctx.db
        .from("entity_identifiers")
        .select("entity_id, normalized")
        .eq("organization_id", ctx.orgId)
        .eq("kind", kind)
        .in("normalized", [...values]);
      if (error) throw error;
      for (const row of data ?? []) {
        matches.set(`identifier::${kind}::${row.normalized}`, row.entity_id);
      }
    }),
    ...[...byDisplayNameType.entries()].map(async ([entityTypeKey, values]) => {
      const entityType = await getEntityTypeByKey(ctx, entityTypeKey);
      const { data, error } = await ctx.db
        .from("entities")
        .select("id, display_name")
        .eq("organization_id", ctx.orgId)
        .eq("entity_type_id", entityType.id)
        .is("deleted_at", null)
        .in("display_name", [...values]);
      if (error) throw error;
      for (const row of data ?? []) {
        matches.set(`display_name::${entityTypeKey}::${row.display_name}`, row.id);
      }
    }),
    ...[...byIdType.entries()].map(async ([entityTypeKey, values]) => {
      const entityType = await getEntityTypeByKey(ctx, entityTypeKey);
      const { data, error } = await ctx.db
        .from("entities")
        .select("id")
        .eq("organization_id", ctx.orgId)
        .eq("entity_type_id", entityType.id)
        .is("deleted_at", null)
        .in("id", [...values]);
      if (error) throw error;
      for (const row of data ?? []) matches.set(`id::${entityTypeKey}::${row.id}`, row.id);
    })
  ]);

  return matches;
}

function resolveEntityLinksForRow(
  links: EntityLinkMapping[],
  row: RawImportRow,
  matches: Map<LinkMatchKey, string>
): ResolvedEntityLink[] {
  const resolved: ResolvedEntityLink[] = [];

  for (const link of links) {
    const raw = row.raw[link.column]?.trim();
    if (!raw) continue;

    let key: LinkMatchKey | null = null;
    const displayName = raw;
    if (link.matchBy === "identifier" && link.identifierKind) {
      key = `identifier::${link.identifierKind}::${normalizeIdentifier(link.identifierKind, raw)}`;
    } else if (link.matchBy === "display_name") {
      key = `display_name::${link.entityTypeKey}::${raw}`;
    } else if (link.matchBy === "id") {
      key = `id::${link.entityTypeKey}::${raw}`;
    }

    const entityId = key ? matches.get(key) : undefined;
    if (entityId) {
      resolved.push({ outcome: "linked", entityId, relation: link.relation });
      continue;
    }

    if (link.onMissing === "create") {
      resolved.push({
        outcome: "create",
        entityTypeKey: link.entityTypeKey,
        displayName,
        relation: link.relation,
        ...(link.matchBy === "identifier" && link.identifierKind
          ? { identifierKind: link.identifierKind, identifierValue: raw }
          : {})
      });
    } else if (link.onMissing === "fail_row") {
      resolved.push({
        outcome: "fail_row",
        message: `No match for "${raw}" and on_missing is fail_row`
      });
    } else {
      resolved.push({ outcome: "skipped", relation: link.relation });
    }
  }

  return resolved;
}

function reviewEntityLinks(links: ResolvedEntityLink[]): {
  fatal?: true;
  message: string;
  planFlags?: {
    needsReview: true;
    reviewCode: ImportErrorCode;
    reviewMessage: string;
  };
} | null {
  const failed = links.find((link) => link.outcome === "fail_row");
  if (failed?.outcome === "fail_row") {
    return { fatal: true, message: failed.message };
  }

  if (links.some((link) => link.outcome === "skipped")) {
    const message = "One or more entity links were skipped because no matching entity was found";
    return {
      message,
      planFlags: {
        needsReview: true,
        reviewCode: "ENTITY_NOT_FOUND",
        reviewMessage: message
      }
    };
  }

  return null;
}

function resolveFieldWritesForRow(
  fields: DocumentFieldMapping[],
  row: RawImportRow
): ResolvedFieldWrite[] {
  const writes: ResolvedFieldWrite[] = [];

  for (const field of fields) {
    const raw = row.raw[field.column];
    if (raw === undefined || raw.trim() === "") continue;

    if (field.target === "document_date") {
      writes.push({
        target: "document_date",
        value: parseLocaleDate(raw.trim(), field.dateFormat)
      });
    } else {
      writes.push({
        target: "custom_field",
        key: field.key,
        value: parseFieldValue(raw, field.type, {
          dateFormat: field.dateFormat,
          decimalSeparator: field.decimalSeparator
        })
      });
    }
  }

  return writes;
}
