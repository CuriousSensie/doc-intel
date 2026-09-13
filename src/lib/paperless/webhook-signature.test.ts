import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyPaperlessWebhookSignature } from "@/lib/paperless/webhook-signature";

const SECRET = "test-secret";

function sign(body: string, timestamp: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(`${body}${timestamp}`).digest("hex");
}

describe("verifyPaperlessWebhookSignature", () => {
  it("accepts a correctly signed, fresh request", () => {
    const body = '{"paperless_document_id": 42}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(verifyPaperlessWebhookSignature(body, timestamp, sign(body, timestamp), SECRET)).toBe(
      true
    );
  });

  it("rejects a signature computed with the wrong secret", () => {
    const body = '{"paperless_document_id": 42}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(
      verifyPaperlessWebhookSignature(
        body,
        timestamp,
        sign(body, timestamp, "wrong-secret"),
        SECRET
      )
    ).toBe(false);
  });

  it("rejects a signature computed over a different body (tamper detection)", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign('{"paperless_document_id": 42}', timestamp);
    expect(
      verifyPaperlessWebhookSignature('{"paperless_document_id": 99}', timestamp, signature, SECRET)
    ).toBe(false);
  });

  it("rejects a stale timestamp outside the tolerance window (replay protection)", () => {
    const body = '{"paperless_document_id": 42}';
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 10 * 60);
    expect(
      verifyPaperlessWebhookSignature(body, staleTimestamp, sign(body, staleTimestamp), SECRET)
    ).toBe(false);
  });

  it("rejects a non-numeric timestamp", () => {
    const body = '{"paperless_document_id": 42}';
    expect(
      verifyPaperlessWebhookSignature(body, "not-a-number", sign(body, "not-a-number"), SECRET)
    ).toBe(false);
  });
});
