import { createHmac, timingSafeEqual } from "node:crypto";

// Must match infra/scripts/notify-pomocnik.sh's tolerance expectations — that script signs
// body+timestamp together specifically so a captured request can't be replayed indefinitely; a
// signature alone (no timestamp binding) would never expire.
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

export function verifyPaperlessWebhookSignature(
  body: string,
  timestampHeader: string,
  signatureHeader: string,
  secret: string
): boolean {
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) return false;

  const skewSeconds = Math.abs(Date.now() / 1000 - timestamp);
  if (skewSeconds > MAX_CLOCK_SKEW_SECONDS) return false;

  const expected = createHmac("sha256", secret).update(`${body}${timestampHeader}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(signatureHeader, "utf8");

  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}
