import { z } from "zod";

export const createEntitySchema = z.object({
  entityTypeId: z.string().uuid(),
  displayName: z.string().trim().min(1, "Enter a name").max(255),
  data: z.record(z.string(), z.unknown()).default({})
});

export const updateEntitySchema = z.object({
  displayName: z.string().trim().min(1, "Enter a name").max(255).optional(),
  status: z.enum(["active", "archived"]).optional(),
  data: z.record(z.string(), z.unknown()).optional()
});

export const listEntitiesSchema = z.object({
  entityTypeId: z.string().uuid().optional(),
  q: z.string().trim().max(200).optional(),
  status: z.enum(["active", "archived"]).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional()
});

export const addIdentifierSchema = z.object({
  kind: z.string().trim().min(1).max(60),
  value: z.string().trim().min(1).max(255)
});

export const mergeEntitiesSchema = z.object({
  keepId: z.string().uuid(),
  mergeId: z.string().uuid()
});
