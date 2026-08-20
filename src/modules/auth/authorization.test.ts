import { describe, expect, it } from "vitest";

import { can, getLimit, hasFeature } from "@/modules/auth/authorization";

describe("authorization helpers", () => {
  it("checks role permissions", () => {
    expect(can("owner", "organization.billing.manage")).toBe(true);
    expect(can("admin", "organization.members.invite")).toBe(true);
    expect(can("member", "organization.members.invite")).toBe(false);
  });

  it("resolves plan features and limits", () => {
    expect(hasFeature("pro", "projects")).toBe(true);
    expect(getLimit("free", "teamMembers")).toBe(1);
  });
});
