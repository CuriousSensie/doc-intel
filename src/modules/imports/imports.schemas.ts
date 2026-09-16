import { z } from "zod";

import { ENTITY_FIELD_TYPES } from "@/modules/entities/field-schema";
import { DATE_FORMATS } from "@/lib/import/locale";

// specs/06-importer.md §Scope: the three import kinds. Kept as the single source of truth —
// import_jobs.kind's CHECK constraint (supabase/migrations/20260915112736_...) enumerates the
// same three values.
export const IMPORT_KINDS = ["entities", "documents", "metadata_only"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const importKindSchema = z.enum(IMPORT_KINDS);

const dateFormatSchema = z.enum(Object.keys(DATE_FORMATS) as [keyof typeof DATE_FORMATS]);
const decimalSeparatorSchema = z.enum([",", "."]);
const columnRef = z.number().int().min(0);

export const createImportJobSchema = z.object({
  kind: importKindSchema,
  filename: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  fromMappingId: z.string().uuid().optional()
});

// -------------------------------------------------------------------------------------------
// kind: "entities" — a row becomes (or updates) one entity of a single, fixed entity type.
// -------------------------------------------------------------------------------------------

export const entityFieldMappingSchema = z.object({
  column: columnRef,
  key: z.string().trim().min(1),
  type: z.enum(ENTITY_FIELD_TYPES),
  dateFormat: dateFormatSchema.optional(),
  decimalSeparator: decimalSeparatorSchema.optional()
});

export const entityImportMappingSchema = z.object({
  entityTypeKey: z.string().trim().min(1),
  displayNameColumn: columnRef,
  // specs/06-importer.md §Matching: "identifier | Normalized lookup ... the primary path" —
  // more than one identifier column is common (e.g. VAT + internal ERP id on the same row).
  identifierColumns: z
    .array(z.object({ kind: z.string().trim().min(1), column: columnRef }))
    .min(1),
  fields: z.array(entityFieldMappingSchema).default([])
});

export type EntityImportMapping = z.infer<typeof entityImportMappingSchema>;

// -------------------------------------------------------------------------------------------
// kind: "documents" | "metadata_only" — a row matches (or, for "documents", creates) one
// document and applies field writes + entity connections to it.
// -------------------------------------------------------------------------------------------

// "custom_field" is in specs/06-importer.md's table but deliberately not implemented yet — it
// needs per-document custom field *values* read from Paperless, batched across a whole chunk,
// which nothing in this codebase does today (only definitions are ever read, per the isolation
// spike's confirmed custom_field_defs leak). See docs/adr/0016-defer-custom-field-document-
// matching.md. Rejected at the schema layer so a job can't silently accept a mapping it can't
// actually execute.
export const documentMatchStrategySchema = z.enum(["filename", "checksum", "paperless_id"]);

export const documentByMappingSchema = z.object({
  strategy: documentMatchStrategySchema,
  column: columnRef
});

const relationSchema = z.enum(["belongs_to", "issued_to", "assigned_to", "part_of", "related"]);

export const entityLinkMappingSchema = z
  .object({
    entityTypeKey: z.string().trim().min(1),
    matchBy: z.enum(["identifier", "display_name", "id"]),
    identifierKind: z.string().trim().min(1).optional(),
    column: columnRef,
    relation: relationSchema.default("related"),
    // specs/06-importer.md §Matching: create | skip_connection | fail_row.
    onMissing: z.enum(["create", "skip_connection", "fail_row"]).default("skip_connection")
  })
  .refine((value) => value.matchBy !== "identifier" || Boolean(value.identifierKind), {
    message: 'identifierKind is required when matchBy is "identifier"',
    path: ["identifierKind"]
  });

export type EntityLinkMapping = z.infer<typeof entityLinkMappingSchema>;

export const documentFieldMappingSchema = z.discriminatedUnion("target", [
  z.object({
    column: columnRef,
    target: z.literal("document_date"),
    dateFormat: dateFormatSchema.default("dd.MM.yyyy")
  }),
  z.object({
    column: columnRef,
    target: z.literal("custom_field"),
    key: z.string().trim().min(1),
    type: z.enum(["string", "monetary", "decimal", "integer", "date", "boolean"]).default("string"),
    dateFormat: dateFormatSchema.optional(),
    decimalSeparator: decimalSeparatorSchema.optional()
  })
]);

export type DocumentFieldMapping = z.infer<typeof documentFieldMappingSchema>;

export const documentImportMappingSchema = z.object({
  documentBy: documentByMappingSchema,
  documentTypeKey: z.string().trim().min(1).optional(),
  entityLinks: z.array(entityLinkMappingSchema).default([]),
  fields: z.array(documentFieldMappingSchema).default([]),
  // specs/06-importer.md §Duplicates. skip's second clause (still apply connections to the
  // existing document) is enforced in imports.matching.ts, not here.
  duplicateStrategy: z.enum(["skip", "create_anyway", "fail"]).default("skip")
});

export type DocumentImportMapping = z.infer<typeof documentImportMappingSchema>;

// metadata_only has no archive/document creation concept — same document_by/entityLinks/fields
// shape as "documents" minus duplicateStrategy (nothing is ever created, so there is nothing to
// duplicate-check against).
export const metadataOnlyImportMappingSchema = documentImportMappingSchema.omit({
  duplicateStrategy: true
});

export type MetadataOnlyImportMapping = z.infer<typeof metadataOnlyImportMappingSchema>;

// Selects the right schema for a job's own `kind` — the one place this dispatch happens, so
// analyze/mapping/validate/run can never each grow their own slightly-different switch.
export function mappingSchemaForKind(kind: ImportKind) {
  switch (kind) {
    case "entities":
      return entityImportMappingSchema;
    case "documents":
      return documentImportMappingSchema;
    case "metadata_only":
      return metadataOnlyImportMappingSchema;
  }
}

export type ImportMapping = EntityImportMapping | DocumentImportMapping | MetadataOnlyImportMapping;

export const analysisOptionsSchema = z.object({
  encoding: z
    .enum(["UTF-8", "windows-1250", "windows-1252", "ISO-8859-2", "UTF-16LE", "UTF-16BE"])
    .optional(),
  delimiter: z.enum([",", ";", "\t"]).optional()
});
export type AnalysisOptions = z.infer<typeof analysisOptionsSchema>;
