import { ValidationError } from "@/lib/errors";
import { type FileCategory, filesConfig } from "@/config/files";

const SIGNATURES: { mimeType: string; bytes: number[] }[] = [
  { mimeType: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mimeType: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mimeType: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { mimeType: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] }
];

/**
 * Sniffs the actual file type from its magic bytes rather than trusting the declared MIME type
 * or filename extension. Returns null for formats with no fixed signature (e.g. plain text) or
 * unrecognized content — callers fall back to the declared type for those.
 */
export function sniffMimeType(buffer: Buffer): string | null {
  for (const signature of SIGNATURES) {
    if (buffer.length >= signature.bytes.length && signature.bytes.every((byte, index) => buffer[index] === byte)) {
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

  return null;
}

export function validateFile(
  input: { buffer: Buffer; declaredMimeType: string; size: number },
  category: FileCategory
): string {
  const config = filesConfig.categories[category];

  if (input.size <= 0 || input.size > config.maxSizeBytes) {
    throw new ValidationError(`File size must be between 1 byte and ${config.maxSizeBytes} bytes`);
  }

  const sniffed = sniffMimeType(input.buffer);
  const resolvedMimeType = sniffed ?? input.declaredMimeType;

  if (sniffed && sniffed !== input.declaredMimeType) {
    throw new ValidationError("File content does not match the declared file type");
  }

  if (!config.allowedMimeTypes.includes(resolvedMimeType)) {
    throw new ValidationError(`File type is not allowed for this upload: ${resolvedMimeType}`);
  }

  return resolvedMimeType;
}
