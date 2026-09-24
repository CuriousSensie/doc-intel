import { describe, expect, it } from "vitest";

import { loginSchema, passwordSchema, registerSchema } from "@/modules/auth/auth.schemas";

describe("auth schemas", () => {
  it("requires strong passwords", () => {
    expect(passwordSchema.safeParse("weakpass").success).toBe(false);
    expect(passwordSchema.safeParse("Strongpass1").success).toBe(true);
  });

  it("requires registration terms and matching passwords", () => {
    const result = registerSchema.safeParse({
      name: "Ada Lovelace",
      organizationName: "Analytical Engines Ltd",
      email: "Ada@Example.COM",
      password: "Strongpass1",
      confirmPassword: "Strongpass1",
      terms: "on"
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.email).toBe("ada@example.com");
  });

  it("requires an organization name at registration", () => {
    expect(
      registerSchema.safeParse({
        name: "Ada Lovelace",
        email: "ada@example.com",
        password: "Strongpass1",
        confirmPassword: "Strongpass1",
        terms: "on"
      }).success
    ).toBe(false);
  });

  it("rejects missing login password", () => {
    expect(loginSchema.safeParse({ email: "ada@example.com", password: "" }).success).toBe(false);
  });
});
