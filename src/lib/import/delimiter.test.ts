import { describe, expect, it } from "vitest";

import { sniffDelimiter } from "./delimiter";

describe("sniffDelimiter", () => {
  it("picks ; for a sl-SI-style header", () => {
    expect(sniffDelimiter("Kupec ID;Ime;Znesek")).toBe(";");
  });

  it("picks , when it clearly dominates", () => {
    expect(sniffDelimiter("id,name,amount")).toBe(",");
  });

  it("picks tab for a TSV header", () => {
    expect(sniffDelimiter("id\tname\tamount")).toBe("\t");
  });

  it("prefers ; on a tie between ; and , (spec: sniff ; before ,)", () => {
    // One ";" and one "," — an equal count on both.
    expect(sniffDelimiter("a;b,c")).toBe(";");
  });

  it("falls back to ; for a single-column header with no delimiter present", () => {
    expect(sniffDelimiter("OnlyColumn")).toBe(";");
  });
});
