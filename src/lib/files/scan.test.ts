import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { scanBuffer, scanStream } from "@/lib/files/scan";

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
    expect(result.signature?.toLowerCase()).toContain("eicar");
  });

  it("passes a clean buffer", async () => {
    const result = await scanBuffer(Buffer.from("hello world", "ascii"));
    expect(result).toEqual({ infected: false, signature: null });
  });
});

// Phase 3 M3: ingest-document.ts scans a file streamed from a temp file instead of a
// pre-buffered Buffer (never holding the whole upload in worker memory) — same protocol, same
// clamd, so this must produce identical results to scanBuffer() for the same content, framed
// as multiple stream chunks rather than one buffer.
describe.skipIf(!hasLiveClamav)("scanStream", () => {
  it("flags the EICAR test string as infected when delivered across several chunks", async () => {
    const half = Math.floor(EICAR_TEST_STRING.length / 2);
    const stream = Readable.from([
      EICAR_TEST_STRING.subarray(0, half),
      EICAR_TEST_STRING.subarray(half)
    ]);

    const result = await scanStream(stream);
    expect(result.infected).toBe(true);
    expect(result.signature?.toLowerCase()).toContain("eicar");
  });

  it("passes a clean stream", async () => {
    const result = await scanStream(Readable.from([Buffer.from("hello world", "ascii")]));
    expect(result).toEqual({ infected: false, signature: null });
  });
});
