import { describe, expect, it } from "vitest";

import { parsePostDocumentTaskId } from "@/lib/paperless/tasks";

describe("parsePostDocumentTaskId", () => {
  it("strips the surrounding quotes post_document/ wraps the task id in", () => {
    expect(parsePostDocumentTaskId('"abc-123"')).toBe("abc-123");
  });

  it("is a no-op for an already-unquoted id", () => {
    expect(parsePostDocumentTaskId("abc-123")).toBe("abc-123");
  });

  it("trims surrounding whitespace", () => {
    expect(parsePostDocumentTaskId('  "abc-123"  \n')).toBe("abc-123");
  });
});
