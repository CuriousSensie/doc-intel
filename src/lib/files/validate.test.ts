import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import { sniffMimeType, validateFile } from "@/lib/files/validate";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_BYTES = Buffer.from("%PDF-1.4\n", "ascii");
const WEBP_BYTES = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP", "ascii")
]);

describe("sniffMimeType", () => {
  it("identifies known signatures", () => {
    expect(sniffMimeType(PNG_BYTES)).toBe("image/png");
    expect(sniffMimeType(PDF_BYTES)).toBe("application/pdf");
    expect(sniffMimeType(WEBP_BYTES)).toBe("image/webp");
  });

  it("returns null for content with no known signature", () => {
    expect(sniffMimeType(Buffer.from("hello world", "ascii"))).toBeNull();
  });
});

describe("validateFile", () => {
  it("accepts a file whose sniffed type matches the declared type and category allowlist", () => {
    expect(
      validateFile({ buffer: PNG_BYTES, declaredMimeType: "image/png", size: PNG_BYTES.length }, "avatar")
    ).toBe("image/png");
  });

  it("rejects a file whose sniffed type disagrees with the declared type", () => {
    expect(() =>
      validateFile({ buffer: PDF_BYTES, declaredMimeType: "image/png", size: PDF_BYTES.length }, "document")
    ).toThrow(ValidationError);
  });

  it("rejects a file type not on the category's allowlist even if declared and sniffed agree", () => {
    expect(() =>
      validateFile({ buffer: PDF_BYTES, declaredMimeType: "application/pdf", size: PDF_BYTES.length }, "avatar")
    ).toThrow(ValidationError);
  });

  it("rejects a file over the category's size cap", () => {
    expect(() =>
      validateFile({ buffer: PNG_BYTES, declaredMimeType: "image/png", size: 999_999_999 }, "avatar")
    ).toThrow(ValidationError);
  });

  it("falls back to the declared type for content with no known signature, still enforcing the allowlist", () => {
    const buffer = Buffer.from("name,age\nAda,36\n", "ascii");
    expect(validateFile({ buffer, declaredMimeType: "text/csv", size: buffer.length }, "document")).toBe(
      "text/csv"
    );
  });
});
