import { z } from "zod";

export const documentPermissionSchema = z.enum(["view", "edit"]);

export const shareDocumentSchema = z.object({
  documentId: z.string().uuid(),
  // null = everyone in the organization
  userId: z.string().uuid().nullable(),
  permission: documentPermissionSchema
});

export const unshareDocumentSchema = z.object({
  documentId: z.string().uuid(),
  userId: z.string().uuid().nullable()
});
