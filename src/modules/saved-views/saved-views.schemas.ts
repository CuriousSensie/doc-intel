import { z } from "zod";

const uuidListSchema = z.array(z.string().uuid()).default([]);

export const createSavedViewSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name").max(200),
    scope: z.enum(["documents"]),
    viewKind: z.enum(["dynamic", "static"]).default("dynamic"),
    filters: z.record(z.string(), z.unknown()).default({}),
    columns: z.array(z.string()).default([]),
    sort: z.record(z.string(), z.unknown()).optional(),
    documentIds: uuidListSchema,
    isShared: z.boolean().default(false)
  })
  .superRefine((value, ctx) => {
    if (value.viewKind === "static") {
      if (value.documentIds.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "Choose at least one document",
          path: ["documentIds"]
        });
      }
    }

    if (value.viewKind === "dynamic" && value.documentIds.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "Dynamic views cannot store fixed documents",
        path: ["documentIds"]
      });
    }
  });

export const renameSavedViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "Enter a name").max(200)
});
