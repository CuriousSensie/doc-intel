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
    // Raw newline-separated textarea text — split/trimmed/filtered server-side, not here, since
    // the split logic is shared with the update path and simplest kept in one place.
    options: z.string().optional(),
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
        const lines = (value.options ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
        if (lines.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["options"],
            message: "Enter at least one option, one per line"
          });
        }
      }
    }
  });

// Shared by create/update — the textarea's raw text to a plain label list.
export function parseAttributeOptionsInput(raw: string | undefined): string[] {
  return (raw ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const deleteAttributeSchema = z.object({
  kind: attributeKindSchema,
  id: z.string().trim().min(1)
});
