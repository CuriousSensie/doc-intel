import { z } from "zod";

const dataType = z.enum([
  "string",
  "integer",
  "float",
  "monetary",
  "date",
  "boolean",
  "select",
  "documentlink",
  "url"
]);

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
  options: z.array(z.string().trim().min(1)).optional(),
  appliesTo: z.array(z.string().trim().min(1)).default([]),
  paperlessCustomFieldId: z.number().int().optional(),
  isRequired: z.boolean().default(false)
});

export const updateCustomFieldDefSchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  options: z.array(z.string().trim().min(1)).optional(),
  appliesTo: z.array(z.string().trim().min(1)).optional(),
  isRequired: z.boolean().optional()
});
