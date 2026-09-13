import { z } from "zod";

import { fieldSchemaArraySchema } from "@/modules/entities/field-schema";

export const createEntityTypeSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers, and underscores only"),
  name: z.string().trim().min(1).max(200),
  namePlural: z.string().trim().min(1).max(200),
  icon: z.string().trim().max(60).optional(),
  fieldSchema: fieldSchemaArraySchema.default([])
});

export const updateEntityTypeMetaSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  namePlural: z.string().trim().min(1).max(200).optional(),
  icon: z.string().trim().max(60).optional().nullable()
});

const fieldKeySchema = z.string().trim().min(1).max(100);

export const addFieldSchema = fieldSchemaArraySchema.element;

export const renameFieldLabelSchema = z.object({
  fieldKey: fieldKeySchema,
  label: z.string().trim().min(1).max(200)
});

export const changeFieldTypeSchema = z.object({
  fieldKey: fieldKeySchema,
  type: z.enum([
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
  ])
});

export const removeFieldSchema = z.object({
  fieldKey: fieldKeySchema
});
