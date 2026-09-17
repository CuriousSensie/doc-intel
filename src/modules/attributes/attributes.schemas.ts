import { z } from "zod";

export const attributeKindSchema = z.enum(["tags", "correspondents", "document-types", "custom-fields"]);
export type AttributeKind = z.infer<typeof attributeKindSchema>;

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
    matchingAlgorithm: matchingAlgorithmSchema,
    match: z.string().trim().max(256).optional().or(z.literal(""))
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
  });

export const deleteAttributeSchema = z.object({
  kind: attributeKindSchema,
  id: z.string().trim().min(1)
});
