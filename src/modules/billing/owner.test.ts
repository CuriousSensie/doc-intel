import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "@/modules/auth/session";

const context = { user: { id: "user-1" } } as AuthContext;

describe("resolveBillingOwner", () => {
  it("resolves to the user when billing is not organization-owned", async () => {
    vi.doMock("@/config/billing", () => ({ billingOwnerType: "user" }));
    const { resolveBillingOwner } = await import("@/modules/billing/owner");

    await expect(resolveBillingOwner(context)).resolves.toEqual({ type: "user", id: "user-1" });

    vi.doUnmock("@/config/billing");
    vi.resetModules();
  });

  it("resolves to the active organization when billing is organization-owned", async () => {
    vi.doMock("@/config/billing", () => ({ billingOwnerType: "organization" }));
    vi.doMock("@/modules/organizations/active-organization", () => ({
      getActiveOrganizationId: vi.fn().mockResolvedValue("org-1")
    }));
    const { resolveBillingOwner } = await import("@/modules/billing/owner");

    await expect(resolveBillingOwner(context)).resolves.toEqual({ type: "organization", id: "org-1" });

    vi.doUnmock("@/config/billing");
    vi.doUnmock("@/modules/organizations/active-organization");
    vi.resetModules();
  });

  it("resolves to null when billing is organization-owned but the user has no active organization", async () => {
    vi.doMock("@/config/billing", () => ({ billingOwnerType: "organization" }));
    vi.doMock("@/modules/organizations/active-organization", () => ({
      getActiveOrganizationId: vi.fn().mockResolvedValue(null)
    }));
    const { resolveBillingOwner } = await import("@/modules/billing/owner");

    await expect(resolveBillingOwner(context)).resolves.toBeNull();

    vi.doUnmock("@/config/billing");
    vi.doUnmock("@/modules/organizations/active-organization");
    vi.resetModules();
  });
});
