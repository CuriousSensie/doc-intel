import { z } from "zod";

export const attributeKindSchema = z.enum(["tags", "correspondents", "document-types", "custom-fields"]);
export type AttributeKind = z.infer<typeof attributeKindSchema>;

export const customFieldDataTypeSchema = z.enum([
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
export type CustomFieldDataType = z.infer<typeof customFieldDataTypeSchema>;

export const matchingAlgorithmSchema = z.enum(["none", "any", "all", "exact", "regex", "fuzzy"]);
export type MatchingAlgorithm = z.infer<typeof matchingAlgorithmSchema>;

export const matchingAlgorithmToPaperless: Record<MatchingAlgorithm, number> = {
  none: 0,
  any: 1,
  all: 2,
  exact: 3,
  regex: 4,
  fuzzy: 5
};

export const paperlessToMatchingAlgorithm = new Map<number, MatchingAlgorithm>(
  Object.entries(matchingAlgorithmToPaperless).map(([key, value]) => [
    value,
    key as MatchingAlgorithm
  ])
);

export const attributeFormSchema = z
  .object({
    id: z.string().trim().optional(),
    kind: attributeKindSchema,
    name: z.string().trim().min(1).max(128),
    color: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #6b7280")
      .optional()
      .or(z.literal("")),
    // Real bug found via live testing: the custom-fields form never renders/submits this field
    // (matching is meaningless for a custom field), and this was previously required with no
    // default — every custom-field create/update failed Zod validation before reaching the
    // service layer at all. Defaulting to "none" is a no-op for tags/correspondents/document-
    // types, which always submit a real value from their own visible select.
    matchingAlgorithm: matchingAlgorithmSchema.default("none"),
    match: z.string().trim().max(256).optional().or(z.literal("")),
    // custom-fields kind only
    dataType: customFieldDataTypeSchema.optional(),
    // Repeated inputs from the option editor; a legacy string is also accepted because older
    // textarea submissions used newline-separated text.
    options: z.union([z.string(), z.array(z.string())]).optional(),
    appliesTo: z.array(z.string().trim().min(1)).optional(),
    isRequired: z.boolean().optional()
  })
  .superRefine((value, ctx) => {
    if (value.kind === "tags" && !value.color) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["color"],
        message: "Choose a tag color"
      });
    }

    if (value.matchingAlgorithm !== "none" && !value.match?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["match"],
        message: "Enter matching text or choose None"
      });
    }

    if (value.kind === "custom-fields") {
      if (!value.dataType) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dataType"], message: "Choose a data type" });
      } else if (value.dataType === "select") {
        if (parseAttributeOptionsInput(value.options).length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["options"],
            message: "Enter at least one option"
          });
        }
      }
    }
  });

// Shared by create/update — converts repeated option inputs (or the old textarea shape) to labels.
export function parseAttributeOptionsInput(raw: string | string[] | undefined): string[] {
  const values = Array.isArray(raw) ? raw : (raw ?? "").split("\n");
  return values.map((s) => s.trim()).filter(Boolean);
}

export const deleteAttributeSchema = z.object({
  kind: attributeKindSchema,
  id: z.string().trim().min(1)
});
