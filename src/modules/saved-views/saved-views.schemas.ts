import { z } from "zod";

export const createSavedViewSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(200),
  scope: z.enum(["documents", "entities"]),
  entityTypeId: z.string().uuid().optional(),
  filters: z.record(z.string(), z.unknown()).default({}),
  columns: z.array(z.string()).default([]),
  sort: z.record(z.string(), z.unknown()).optional(),
  isShared: z.boolean().default(false)
});
