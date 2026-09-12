import { ValidationError } from "@/lib/errors";
import { type FileCategory, filesConfig } from "@/config/files";

const SIGNATURES: { mimeType: string; bytes: number[] }[] = [
  { mimeType: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mimeType: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mimeType: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { mimeType: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
  { mimeType: "image/tiff", bytes: [0x49, 0x49, 0x2a, 0x00] },
  { mimeType: "image/tiff", bytes: [0x4d, 0x4d, 0x00, 0x2a] }
];

// OOXML (docx/xlsx) and ODT are all zip containers — the first bytes can't tell them apart from
// each other, only from non-zip content. Sniffing resolves to this generic marker; a declared
// type from this set is trusted to pick the specific variant, the same way sniffMimeType()
// already falls back to the declared type for formats with no fixed signature at all.
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const ZIP_BASED_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.oasis.opendocument.text"
]);

/**
 * Sniffs the actual file type from its magic bytes rather than trusting the declared MIME type
 * or filename extension. Returns null for formats with no fixed signature (e.g. plain text) or
 * unrecognized content — callers fall back to the declared type for those.
 */
export function sniffMimeType(buffer: Buffer): string | null {
  for (const signature of SIGNATURES) {
    if (
      buffer.length >= signature.bytes.length &&
      signature.bytes.every((byte, index) => buffer[index] === byte)
    ) {
      return signature.mimeType;
    }
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  if (
    buffer.length >= ZIP_SIGNATURE.length &&
    ZIP_SIGNATURE.every((byte, index) => buffer[index] === byte)
  ) {
    return "application/zip";
  }

  return null;
}

export type FileValidationConfig = { maxSizeBytes: number; allowedMimeTypes: readonly string[] };

export function validateFileAgainstConfig(
  input: { buffer: Buffer; declaredMimeType: string; size: number },
  config: FileValidationConfig
): string {
  if (input.size <= 0 || input.size > config.maxSizeBytes) {
    throw new ValidationError(`File size must be between 1 byte and ${config.maxSizeBytes} bytes`);
  }

  const sniffed = sniffMimeType(input.buffer);
  const isZipContainerMatch =
    sniffed === "application/zip" && ZIP_BASED_MIME_TYPES.has(input.declaredMimeType);
  const resolvedMimeType = sniffed && !isZipContainerMatch ? sniffed : input.declaredMimeType;

  if (sniffed && sniffed !== input.declaredMimeType && !isZipContainerMatch) {
    throw new ValidationError("File content does not match the declared file type");
  }

  if (!config.allowedMimeTypes.includes(resolvedMimeType)) {
    throw new ValidationError(`File type is not allowed for this upload: ${resolvedMimeType}`);
  }

  return resolvedMimeType;
}

export function validateFile(
  input: { buffer: Buffer; declaredMimeType: string; size: number },
  category: FileCategory
): string {
  return validateFileAgainstConfig(input, filesConfig.categories[category]);
}
