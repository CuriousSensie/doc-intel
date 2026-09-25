import { describe, expect, it } from "vitest";

import { buildCsv, buildXlsx } from "./file-builders";
import type { ResolvedExportData } from "./exports.service";

const sampleData: ResolvedExportData = {
  rows: [
    {
      documentId: "doc-1",
      title: "Invoice; with semicolon",
      documentTypeKey: "invoice",
      documentDate: "2026-03-05",
      status: "ready"
    },
    {
      documentId: "doc-2",
      title: "Plain title",
      documentTypeKey: null,
      documentDate: null,
      status: "processing"
    }
  ]
};

describe("buildCsv", () => {
  it("uses semicolon delimiters and dd.mm.yyyy dates (D7 sl-SI locale)", () => {
    const csv = buildCsv(sampleData);
    const lines = csv.replace(/^﻿/, "").split("\r\n");

    expect(lines[0]).toBe("Title;Type;Date;Status");
    expect(lines[1]).toBe('"Invoice; with semicolon";invoice;05.03.2026;ready');
    expect(lines[2]).toBe("Plain title;;;processing");
  });

  it("starts with a UTF-8 BOM so Excel opens it correctly", () => {
    expect(buildCsv(sampleData).charCodeAt(0)).toBe(0xfeff);
  });
});

describe("buildXlsx", () => {
  it("produces a non-empty workbook buffer with a header row and one row per document", async () => {
    const buffer = await buildXlsx(sampleData);
    expect(buffer.length).toBeGreaterThan(0);

    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("Documents");

    expect(sheet?.getRow(1).getCell(1).value).toBe("Title");
    expect(sheet?.getRow(2).getCell(1).value).toBe("Invoice; with semicolon");
    expect(sheet?.getRow(3).getCell(1).value).toBe("Plain title");
    expect(sheet?.rowCount).toBe(3);
  });
});
