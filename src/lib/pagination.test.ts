import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor } from "@/lib/pagination";

describe("cursor pagination", () => {
  it("round-trips a cursor through encode/decode", () => {
    const cursor = { createdAt: "2026-08-22T10:00:00.000Z", id: "abc-123" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("returns null for missing or malformed cursors", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("not-valid-base64url-!!!")).toBeNull();
  });
});
