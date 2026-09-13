import { describe, expect, it } from "vitest";

import { scanBuffer } from "@/lib/files/scan";

// Real clamd, not mocked (specs/12-agent-rules.md's "never trust a mocked Paperless" spirit
// extends to any service whose real behavior is the thing worth verifying) — runs only when
// infra/docker-compose.yml's clamav service is up and CLAMAV_HOST is set, same skip convention
// as provision-tenant.test.ts's hasLivePaperless.
const hasLiveClamav = Boolean(process.env.CLAMAV_HOST);

// Standard antivirus test string (https://www.eicar.org/download-anti-malware-testfile/) — every
// AV engine, including ClamAV, is defined to flag it without being an actual virus.
const EICAR_TEST_STRING = Buffer.from(
  String.raw`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`,
  "ascii"
);

describe.skipIf(!hasLiveClamav)("scanBuffer", () => {
  it("flags the EICAR test string as infected", async () => {
    const result = await scanBuffer(EICAR_TEST_STRING);
    expect(result.infected).toBe(true);
    expect(result.signature).toContain("EICAR");
  });

  it("passes a clean buffer", async () => {
    const result = await scanBuffer(Buffer.from("hello world", "ascii"));
    expect(result).toEqual({ infected: false, signature: null });
  });
});
