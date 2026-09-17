import { describe, expect, it } from "vitest";

import { normalizeIdentifier } from "@/modules/entities/identifier-normalization";

describe("normalizeIdentifier", () => {
  it("normalizes Slovenian VAT numbers to the same value regardless of formatting", () => {
    expect(normalizeIdentifier("vat", "SI 1234 5678")).toBe("SI12345678");
    expect(normalizeIdentifier("vat", "si12345678")).toBe("SI12345678");
    expect(normalizeIdentifier("vat", "SI-12345678")).toBe("SI12345678");
  });

  it("strips non-digits for company_reg (matična številka)", () => {
    expect(normalizeIdentifier("company_reg", "1234567")).toBe("1234567");
    expect(normalizeIdentifier("company_reg", "123-4567")).toBe("1234567");
    expect(normalizeIdentifier("company_reg", " 12 34 567 ")).toBe("1234567");
  });

  it("uppercases, trims, and collapses whitespace for erp_id", () => {
    expect(normalizeIdentifier("erp_id", "  cust   001  ")).toBe("CUST 001");
  });

  it("lowercases and trims for email", () => {
    expect(normalizeIdentifier("email", "  Owner@Example.com ")).toBe("owner@example.com");
  });

  it("falls back to uppercase/trim/collapse for an unrecognized kind", () => {
    expect(normalizeIdentifier("invoice_no", "  inv   0042  ")).toBe("INV 0042");
  });
});
