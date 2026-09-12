import { describe, expect, it } from "vitest";

import { documentsConfig } from "@/config/documents";
import { ValidationError } from "@/lib/errors";
import { sniffMimeType, validateFile, validateFileAgainstConfig } from "@/lib/files/validate";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_BYTES = Buffer.from("%PDF-1.4\n", "ascii");
const WEBP_BYTES = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP", "ascii")
]);
const TIFF_LE_BYTES = Buffer.from([0x49, 0x49, 0x2a, 0x00]);
const TIFF_BE_BYTES = Buffer.from([0x4d, 0x4d, 0x00, 0x2a]);
const ZIP_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

describe("sniffMimeType", () => {
  it("identifies known signatures", () => {
    expect(sniffMimeType(PNG_BYTES)).toBe("image/png");
    expect(sniffMimeType(PDF_BYTES)).toBe("application/pdf");
    expect(sniffMimeType(WEBP_BYTES)).toBe("image/webp");
  });

  it("returns null for content with no known signature", () => {
    expect(sniffMimeType(Buffer.from("hello world", "ascii"))).toBeNull();
  });

  it("identifies both TIFF byte orders", () => {
    expect(sniffMimeType(TIFF_LE_BYTES)).toBe("image/tiff");
    expect(sniffMimeType(TIFF_BE_BYTES)).toBe("image/tiff");
  });

  it("identifies a zip container as the generic application/zip marker", () => {
    expect(sniffMimeType(ZIP_BYTES)).toBe("application/zip");
  });
});

describe("validateFile", () => {
  it("accepts a file whose sniffed type matches the declared type and category allowlist", () => {
    expect(
      validateFile(
        { buffer: PNG_BYTES, declaredMimeType: "image/png", size: PNG_BYTES.length },
        "avatar"
      )
    ).toBe("image/png");
  });

  it("rejects a file whose sniffed type disagrees with the declared type", () => {
    expect(() =>
      validateFile(
        { buffer: PDF_BYTES, declaredMimeType: "image/png", size: PDF_BYTES.length },
        "document"
      )
    ).toThrow(ValidationError);
  });

  it("rejects a file type not on the category's allowlist even if declared and sniffed agree", () => {
    expect(() =>
      validateFile(
        { buffer: PDF_BYTES, declaredMimeType: "application/pdf", size: PDF_BYTES.length },
        "avatar"
      )
    ).toThrow(ValidationError);
  });

  it("rejects a file over the category's size cap", () => {
    expect(() =>
      validateFile(
        { buffer: PNG_BYTES, declaredMimeType: "image/png", size: 999_999_999 },
        "avatar"
      )
    ).toThrow(ValidationError);
  });

  it("falls back to the declared type for content with no known signature, still enforcing the allowlist", () => {
    const buffer = Buffer.from("name,age\nAda,36\n", "ascii");
    expect(
      validateFile({ buffer, declaredMimeType: "text/csv", size: buffer.length }, "document")
    ).toBe("text/csv");
  });
});

describe("validateFileAgainstConfig", () => {
  it("accepts a zip-container file whose declared type is one of the known OOXML/ODT variants", () => {
    const declaredMimeType =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(
      validateFileAgainstConfig(
        { buffer: ZIP_BYTES, declaredMimeType, size: ZIP_BYTES.length },
        documentsConfig
      )
    ).toBe(declaredMimeType);
  });

  it("rejects a zip-container file declared as a non-zip-based type", () => {
    expect(() =>
      validateFileAgainstConfig(
        { buffer: ZIP_BYTES, declaredMimeType: "application/pdf", size: ZIP_BYTES.length },
        documentsConfig
      )
    ).toThrow(ValidationError);
  });

  it("accepts a TIFF file against the documents config", () => {
    expect(
      validateFileAgainstConfig(
        { buffer: TIFF_LE_BYTES, declaredMimeType: "image/tiff", size: TIFF_LE_BYTES.length },
        documentsConfig
      )
    ).toBe("image/tiff");
  });
});
