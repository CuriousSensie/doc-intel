import { beforeAll, describe, expect, it } from "vitest";

// env.ts reads process.env at import time — dynamic import after stubbing it is required.
let encryptPaperlessToken: (typeof import("./token-crypto"))["encryptPaperlessToken"];
let decryptPaperlessToken: (typeof import("./token-crypto"))["decryptPaperlessToken"];

beforeAll(async () => {
  process.env.PAPERLESS_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const mod = await import("./token-crypto");
  encryptPaperlessToken = mod.encryptPaperlessToken;
  decryptPaperlessToken = mod.decryptPaperlessToken;
});

describe("paperless token crypto", () => {
  it("round-trips a token through encrypt/decrypt", () => {
    const token = "abc123def456-a-real-looking-paperless-api-token";
    const encrypted = encryptPaperlessToken(token);

    expect(encrypted).toBeInstanceOf(Buffer);
    expect(encrypted.toString("utf8")).not.toContain(token);
    expect(decryptPaperlessToken(encrypted)).toBe(token);
  });

  it("produces different ciphertext for the same plaintext each time (random IV)", () => {
    const token = "same-token-twice";
    const first = encryptPaperlessToken(token);
    const second = encryptPaperlessToken(token);

    expect(first.equals(second)).toBe(false);
    expect(decryptPaperlessToken(first)).toBe(token);
    expect(decryptPaperlessToken(second)).toBe(token);
  });

  it("throws rather than silently returning garbage if the ciphertext is tampered with", () => {
    const encrypted = encryptPaperlessToken("a-token");
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] ^= 0xff;

    expect(() => decryptPaperlessToken(tampered)).toThrow();
  });
});
