import { afterEach, describe, expect, it, vi } from "vitest";

import type { RenderedEmail } from "@/lib/email/types";

const baseMessage: RenderedEmail = {
  to: "member@example.com",
  from: "Documenti <no-reply@documenti.net>",
  subject: "Original subject",
  html: "<p>Hello</p>",
  text: "Hello"
};

describe("applyDevRecipientOverride", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("leaves the message untouched when no dev recipient is configured", async () => {
    const { applyDevRecipientOverride } = await import("@/lib/email");

    expect(applyDevRecipientOverride(baseMessage)).toEqual(baseMessage);
  });

  it("reroutes to the dev recipient and tags the subject when configured", async () => {
    vi.stubEnv("EMAIL_DEV_RECIPIENT", "dev@example.com");
    const { applyDevRecipientOverride } = await import("@/lib/email");

    const result = applyDevRecipientOverride(baseMessage);

    expect(result.to).toBe("dev@example.com");
    expect(result.subject).toBe("[dev -> member@example.com] Original subject");
    expect(result.html).toBe(baseMessage.html);
  });

  it("does not reroute when the dev recipient matches the real recipient", async () => {
    vi.stubEnv("EMAIL_DEV_RECIPIENT", baseMessage.to);
    const { applyDevRecipientOverride } = await import("@/lib/email");

    expect(applyDevRecipientOverride(baseMessage)).toEqual(baseMessage);
  });
});
