import { describe, expect, it } from "vitest";

import {
  createOrganizationSchema,
  inviteMemberSchema,
  transferOwnershipSchema,
  updateOrganizationSchema
} from "@/modules/organizations/organizations.schemas";

describe("organizations schemas", () => {
  it("requires an organization name and allows an optional custom slug", () => {
    expect(createOrganizationSchema.safeParse({ name: "Acme Inc" }).success).toBe(true);
    expect(createOrganizationSchema.safeParse({ name: "Acme Inc", slug: "acme-inc" }).success).toBe(
      true
    );
    expect(
      createOrganizationSchema.safeParse({ name: "Acme Inc", slug: "Not Valid!" }).success
    ).toBe(false);
    expect(createOrganizationSchema.safeParse({ name: "A" }).success).toBe(false);
  });

  it("lowercases invite emails and restricts assignable roles", () => {
    const result = inviteMemberSchema.safeParse({
      name: "Jamie Doe",
      email: "Member@Example.COM",
      role: "admin"
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.email).toBe("member@example.com");

    expect(
      inviteMemberSchema.safeParse({ name: "Jamie Doe", email: "member@example.com", role: "owner" })
        .success
    ).toBe(false);
    expect(
      inviteMemberSchema.safeParse({ email: "member@example.com", role: "admin" }).success
    ).toBe(false);
  });

  it("allows the read-only role as an assignable role", () => {
    // 4th role — never "owner", which stays rejected above.
    expect(
      inviteMemberSchema.safeParse({ name: "Jamie Doe", email: "viewer@example.com", role: "read-only" })
        .success
    ).toBe(true);
  });

  it("validates update organization and transfer ownership payloads", () => {
    expect(updateOrganizationSchema.safeParse({ name: "Acme Inc" }).success).toBe(true);
    expect(updateOrganizationSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(
      transferOwnershipSchema.safeParse({ newOwnerId: "8e6f5f2e-6b8d-4e4b-8f4a-0b7a2f0c9b11" })
        .success
    ).toBe(true);
    expect(transferOwnershipSchema.safeParse({ newOwnerId: "not-a-uuid" }).success).toBe(false);
  });
});
