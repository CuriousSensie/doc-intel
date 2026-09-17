import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { can, getLimit, hasFeature } from "@/modules/auth/authorization";

describe("authorization helpers", () => {
  it("checks role permissions", () => {
    expect(can("owner", "organization.billing.manage")).toBe(true);
    expect(can("admin", "organization.members.invite")).toBe(true);
    expect(can("member", "organization.members.invite")).toBe(false);
  });

  it("resolves plan features and limits", () => {
    expect(hasFeature("pro", "storageMb")).toBe(true);
    expect(getLimit("free", "teamMembers")).toBe(1);
  });
});

describe("requireSubscription", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("@/modules/billing/billing.service");
    vi.resetModules();
  });

  it("returns the plan when it is in the allowed list", async () => {
    vi.doMock("@/modules/billing/billing.service", () => ({
      getOwnerPlan: vi.fn().mockResolvedValue("pro")
    }));

    const { requireSubscription } = await import("@/modules/auth/authorization");
    const owner = { type: "user" as const, id: "user-1" };

    await expect(requireSubscription(owner, ["pro", "team"])).resolves.toBe("pro");
  });

  it("throws when the plan is not in the allowed list", async () => {
    vi.doMock("@/modules/billing/billing.service", () => ({
      getOwnerPlan: vi.fn().mockResolvedValue("free")
    }));

    const { requireSubscription } = await import("@/modules/auth/authorization");
    const owner = { type: "user" as const, id: "user-1" };

    await expect(requireSubscription(owner, ["pro", "team"])).rejects.toThrow(
      "This action requires one of the following plans"
    );
  });
});
