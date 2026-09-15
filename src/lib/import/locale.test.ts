import { describe, expect, it } from "vitest";

import { parseLocaleDate, parseLocaleNumber } from "./locale";

describe("parseLocaleNumber", () => {
  it("parses sl-SI thousands+decimal notation (1.234,56)", () => {
    expect(parseLocaleNumber("1.234,56", ",")).toBe(1234.56);
  });

  it("parses a plain integer with a comma decimal separator", () => {
    expect(parseLocaleNumber("100", ",")).toBe(100);
  });

  it("parses en-US notation (1,234.56) when the decimal separator is a period", () => {
    expect(parseLocaleNumber("1,234.56", ".")).toBe(1234.56);
  });

  it("parses a negative number", () => {
    expect(parseLocaleNumber("-1.234,56", ",")).toBe(-1234.56);
  });

  it("strips currency noise", () => {
    expect(parseLocaleNumber("€ 1.234,56", ",")).toBe(1234.56);
  });

  it("rejects an empty value", () => {
    expect(() => parseLocaleNumber("", ",")).toThrow(/is not a number/);
  });

  it("rejects text that isn't a number", () => {
    expect(() => parseLocaleNumber("abc", ",")).toThrow(/not a valid decimal number/);
  });

  it("tags thrown errors with the INVALID_NUMBER code", () => {
    try {
      parseLocaleNumber("abc", ",");
      expect.unreachable();
    } catch (err) {
      expect((err as { code?: string }).code).toBe("INVALID_NUMBER");
    }
  });
});

describe("parseLocaleDate", () => {
  it("parses dd.MM.yyyy (the sl-SI default)", () => {
    expect(parseLocaleDate("03.09.2026", "dd.MM.yyyy")).toBe("2026-09-03");
  });

  it("parses dd/MM/yyyy", () => {
    expect(parseLocaleDate("03/09/2026", "dd/MM/yyyy")).toBe("2026-09-03");
  });

  it("parses yyyy-MM-dd (already ISO)", () => {
    expect(parseLocaleDate("2026-09-03", "yyyy-MM-dd")).toBe("2026-09-03");
  });

  it("rejects a value that doesn't match the named format", () => {
    expect(() => parseLocaleDate("2026-09-03", "dd.MM.yyyy")).toThrow(/does not match/);
  });

  it("rejects a calendar-invalid date instead of letting it roll over", () => {
    // Date would silently roll 31.02 forward into March if not explicitly checked.
    expect(() => parseLocaleDate("31.02.2026", "dd.MM.yyyy")).toThrow(/not a real calendar date/);
  });

  it("tags thrown errors with the INVALID_DATE code", () => {
    try {
      parseLocaleDate("not-a-date", "dd.MM.yyyy");
      expect.unreachable();
    } catch (err) {
      expect((err as { code?: string }).code).toBe("INVALID_DATE");
    }
  });
});
