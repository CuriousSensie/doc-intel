import { describe, expect, it } from "vitest";

import { parseEnv } from "@/lib/env";

describe("parseEnv", () => {
  it("applies safe development defaults", () => {
    const env = parseEnv({});

    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    expect(env.NEXT_PUBLIC_APP_NAME).toBe("MVP Boilerplate");
    expect(env.EMAIL_MODE).toBe("console");
  });

  it("rejects invalid public URLs", () => {
    expect(() =>
      parseEnv({
        NEXT_PUBLIC_APP_URL: "not-a-url"
      })
    ).toThrow(/Invalid environment configuration/);
  });
});
