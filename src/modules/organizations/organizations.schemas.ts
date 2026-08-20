import { z } from "zod";

const email = z.string().trim().email("Enter a valid email address").toLowerCase();
const assignableRole = z.enum(["admin", "member"]);

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, "Enter an organization name").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]*$/, "Use lowercase letters, numbers, and hyphens only")
    .max(60)
    .optional()
    .or(z.literal(""))
});

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2, "Enter an organization name").max(120),
  logoUrl: z.string().trim().url("Enter a valid URL").max(2048).optional().or(z.literal(""))
});

export const inviteMemberSchema = z.object({
  email,
  role: assignableRole
});

export const updateMemberRoleSchema = z.object({
  memberId: z.string().uuid(),
  role: assignableRole
});

export const transferOwnershipSchema = z.object({
  newOwnerId: z.string().uuid()
});

export const removeMemberSchema = z.object({
  memberId: z.string().uuid()
});
