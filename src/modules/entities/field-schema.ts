// specs/05-level-1-structure.md §Entity types — the field_schema JSON shape stored on
// entity_types.field_schema, plus the dynamic per-entity data validator built from it.
import { z } from "zod";

import { ValidationError } from "@/lib/errors";

export const ENTITY_FIELD_TYPES = [
  "string",
  "text",
  "integer",
  "decimal",
  "monetary",
  "date",
  "boolean",
  "select",
  "multiselect",
  "email",
  "phone",
  "url"
] as const;

export type EntityFieldType = (typeof ENTITY_FIELD_TYPES)[number];

export type EntityFieldDefinition = {
  key: string;
  label: string;
  type: EntityFieldType;
  required?: boolean;
  options?: string[];
  identifier_kind?: string;
  // Soft-removed (specs/05 §Schema evolution rules: "Removing a field: soft — hidden from UI,
  // data retained in `data` jsonb for 90 days"). Never physically stripped from field_schema by
  // application code; a retention sweep is a Phase 5 concern.
  hidden?: boolean;
};

const fieldDefinitionSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z][a-z0-9_]*$/, "Field key must be lowercase snake_case"),
  label: z.string().trim().min(1).max(200),
  type: z.enum(ENTITY_FIELD_TYPES),
  required: z.boolean().optional(),
  options: z.array(z.string().trim().min(1)).optional(),
  identifier_kind: z.string().trim().min(1).max(60).optional(),
  hidden: z.boolean().optional()
});

export const fieldSchemaArraySchema = z.array(fieldDefinitionSchema);

// One field type may only ever change into another where every existing value stays
// representable — specs/05's one documented case. Anything else is a rejected change, not a
// silent coercion.
const LOSSLESS_TYPE_CHANGES: Partial<Record<EntityFieldType, EntityFieldType[]>> = {
  string: ["text"]
};

export function assertLosslessTypeChange(from: EntityFieldType, to: EntityFieldType): void {
  if (from === to) return;

  if (!LOSSLESS_TYPE_CHANGES[from]?.includes(to)) {
    throw new ValidationError(
      `Changing field type from "${from}" to "${to}" is not a lossless change — create a new field instead`
    );
  }
}

function fieldValueSchema(field: EntityFieldDefinition): z.ZodTypeAny {
  let schema: z.ZodTypeAny;

  switch (field.type) {
    case "integer":
      schema = z.number().int();
      break;
    case "decimal":
    case "monetary":
      schema = z.number();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    case "date":
      schema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-mm-dd");
      break;
    case "email":
      schema = z.string().trim().email();
      break;
    case "url":
      schema = z.string().trim().url();
      break;
    case "select":
      schema = field.options?.length ? z.enum(field.options as [string, ...string[]]) : z.string();
      break;
    case "multiselect":
      schema = field.options?.length
        ? z.array(z.enum(field.options as [string, ...string[]]))
        : z.array(z.string());
      break;
    case "phone":
      schema = z.string().trim().min(1).max(40);
      break;
    case "text":
      schema = z.string();
      break;
    case "string":
    default:
      schema = z.string().trim().max(2000);
      break;
  }

  return field.required ? schema : schema.optional().nullable();
}

// Built fresh per entity type rather than a single static export — the shape is genuinely
// tenant-defined (specs/12-agent-rules.md's "shared Zod schema" rule still holds: this is the
// one function every entity create/update path and, later, the entity-editing form must go
// through, so the *validation logic* is shared even though the schema itself is dynamic.
export function buildEntityDataSchema(fieldSchema: EntityFieldDefinition[]) {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fieldSchema) {
    if (field.hidden) continue;
    shape[field.key] = fieldValueSchema(field);
  }

  return z.object(shape).passthrough();
}

export function validateEntityData(
  fieldSchema: EntityFieldDefinition[],
  data: Record<string, unknown>
): Record<string, unknown> {
  const result = buildEntityDataSchema(fieldSchema).safeParse(data);

  if (!result.success) {
    throw new ValidationError(result.error.issues.map((issue) => issue.message).join("; "));
  }

  return result.data;
}
