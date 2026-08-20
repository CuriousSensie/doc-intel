import { describe, expect, it } from "vitest";

import { getSafeRedirectPath, withStatus } from "@/modules/auth/redirects";

describe("auth redirects", () => {
  it("allows local paths", () => {
    expect(getSafeRedirectPath("/dashboard")).toBe("/dashboard");
  });

  it("blocks external and protocol-relative redirects", () => {
    expect(getSafeRedirectPath("https://example.com")).toBe("/dashboard");
    expect(getSafeRedirectPath("//example.com")).toBe("/dashboard");
  });

  it("adds status messages to local paths", () => {
    expect(withStatus("/login", "message", "Check email")).toBe("/login?message=Check+email");
  });
});
