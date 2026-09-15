import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";

import { decodeBuffer, detectEncoding } from "./encoding";

// Real chardet/iconv-lite, not mocked — encoding detection accuracy is the actual thing worth
// verifying (specs/06-importer.md: "mis-detected encoding turns č into mojibake across the
// entire dataset").
describe("detectEncoding", () => {
  it("detects real UTF-8 content with high confidence", () => {
    const sample = Buffer.from(
      "Kupec ID;Ime;Znesek\n1023;Podjetje čšž d.o.o.;1.234,56\n1024;Another ČŠŽ;2.500,00\n",
      "utf8"
    );
    const result = detectEncoding(sample);
    expect(result.encoding).toBe("UTF-8");
  });

  it("falls back to windows-1250 for a real windows-1250 (sl-SI legacy export) sample", () => {
    // Verified live: chardet scores this an exact tie with windows-1252 (see encoding.ts's
    // comment) — it isn't valid UTF-8 at all, so the fallback (which happens to be the
    // correct answer here) is what specs/06-importer.md actually asks for, not a guess.
    const sample = iconv.encode(
      "Kupec ID;Ime;Znesek\n1023;Podjetje čšž d.o.o.;1.234,56\n1024;Another ČŠŽ;2.500,00\n",
      "windows-1250"
    );
    const result = detectEncoding(sample);
    expect(result.encoding).toBe("windows-1250");
  });

  it("falls back to windows-1250 for ambiguous/low-confidence samples", () => {
    // Pure ASCII, no diacritics anywhere — harmless either way (ASCII decodes identically
    // under UTF-8 and windows-1250), but confirms the fallback path, not a UTF-8 false positive.
    const sample = Buffer.from("id;name;amount\n1;foo;100\n", "ascii");
    const result = detectEncoding(sample);
    expect(result.encoding).toBe("windows-1250");
  });
});

describe("decodeBuffer", () => {
  it("round-trips windows-1250-encoded Slovenian diacritics back to the original text", () => {
    const original = "Račun za stranko: čšž ČŠŽ";
    const encoded = iconv.encode(original, "windows-1250");
    expect(decodeBuffer(encoded, "windows-1250")).toBe(original);
  });

  it("mangles the same bytes if decoded under the wrong encoding (documents the failure mode)", () => {
    const original = "čšž";
    const encoded = iconv.encode(original, "windows-1250");
    expect(decodeBuffer(encoded, "utf8")).not.toBe(original);
  });
});
