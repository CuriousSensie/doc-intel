import { describe, expect, it } from "vitest";

import { parseEnv } from "@/lib/env";

describe("parseEnv", () => {
  it("applies safe development defaults", () => {
    const env = parseEnv({});

    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    expect(env.NEXT_PUBLIC_APP_NAME).toBe("MVP Boilerplate");
    expect(env.EMAIL_PROVIDER).toBe("console");
    expect(env.SMTP_SECURE).toBe(false);
  });

  it("rejects invalid public URLs", () => {
    expect(() =>
      parseEnv({
        NEXT_PUBLIC_APP_URL: "not-a-url"
      })
    ).toThrow(/Invalid environment configuration/);
  });

  it("parses SMTP_SECURE as a real boolean instead of coercing any non-empty string to true", () => {
    expect(parseEnv({ SMTP_SECURE: "false" }).SMTP_SECURE).toBe(false);
    expect(parseEnv({ SMTP_SECURE: "true" }).SMTP_SECURE).toBe(true);
  });
});
