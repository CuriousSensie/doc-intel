import { z } from "zod";

const dataType = z.enum([
  "string",
  "integer",
  "float",
  "monetary",
  "date",
  "boolean",
  "select",
  "url"
]);

// A select field's options are Paperless-generated {id, label} pairs — the document *value*
// must reference the id, never the label (confirmed live against the pinned instance). `id` is
// optional on input since a caller minting brand-new options (not yet round-tripped through
// Paperless) may not have one yet; it's always present once persisted.
const selectOptionSchema = z.object({
  id: z.string().trim().min(1).optional(),
  label: z.string().trim().min(1)
});

export const createCustomFieldDefSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(100)
    .regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers, and underscores only"),
  label: z.string().trim().min(1).max(200),
  dataType,
  options: z.array(selectOptionSchema).optional(),
  appliesTo: z.array(z.string().trim().min(1)).default([]),
  paperlessCustomFieldId: z.number().int().optional(),
  isRequired: z.boolean().default(false)
});

export const updateCustomFieldDefSchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  options: z.array(selectOptionSchema).optional(),
  appliesTo: z.array(z.string().trim().min(1)).optional(),
  isRequired: z.boolean().optional()
});
