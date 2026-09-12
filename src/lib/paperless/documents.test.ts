import { describe, expect, it } from "vitest";

import { toDocumentTypeKey } from "@/lib/paperless/documents";

describe("toDocumentTypeKey", () => {
  it("lowercases and underscores a multi-word name", () => {
    expect(toDocumentTypeKey("Service report")).toBe("service_report");
  });

  it("is a no-op for an already-simple name", () => {
    expect(toDocumentTypeKey("Invoice")).toBe("invoice");
  });

  it("collapses punctuation and trims leading/trailing separators", () => {
    expect(toDocumentTypeKey("  Quotation (draft)! ")).toBe("quotation_draft");
  });
});
