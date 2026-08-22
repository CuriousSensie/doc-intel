import { describe, expect, it } from "vitest";

import { adminAdjustCredits, grantCredits } from "@/modules/billing/credits.service";

const owner = { type: "user" as const, id: "user-1" };

describe("grantCredits", () => {
  it("rejects non-positive amounts", async () => {
    await expect(grantCredits(owner, 0, "purchase")).rejects.toThrow("must be positive");
    await expect(grantCredits(owner, -5, "purchase")).rejects.toThrow("must be positive");
  });
});

describe("adminAdjustCredits", () => {
  it("rejects a zero adjustment", async () => {
    await expect(adminAdjustCredits(owner, 0, "admin-1")).rejects.toThrow("must not be zero");
  });
});
