import ExcelJS from "exceljs";

import type { ResolvedExportData } from "./exports.service";

// D7 (specs/00-overview.md): dd.mm.yyyy dates for sl-SI.
function formatDate(value: string | null): string {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function columns(entityTypeColumns: ResolvedExportData["entityTypeColumns"]) {
  return [
    { key: "title", label: "Title" },
    { key: "documentTypeKey", label: "Type" },
    { key: "documentDate", label: "Date" },
    { key: "correspondentName", label: "Correspondent" },
    { key: "status", label: "Status" },
    ...entityTypeColumns
  ];
}

function rowValues(row: ResolvedExportData["rows"][number], cols: ReturnType<typeof columns>) {
  return cols.map((col) => {
    switch (col.key) {
      case "title":
        return row.title;
      case "documentTypeKey":
        return row.documentTypeKey ?? "";
      case "documentDate":
        return formatDate(row.documentDate);
      case "correspondentName":
        return row.correspondentName ?? "";
      case "status":
        return row.status;
      default:
        return row.entityColumns[col.key] ?? "";
    }
  });
}

function csvEscape(value: string): string {
  // sl-SI delimiter is ';' (specs/05: "CSV with comma decimals and semicolon delimiters" —
  // avoids the recurring corrupted-open-in-Excel issue the spec calls out by name).
  if (value.includes(";") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildCsv(data: ResolvedExportData): string {
  const cols = columns(data.entityTypeColumns);
  const lines = [cols.map((c) => csvEscape(c.label)).join(";")];
  for (const row of data.rows) {
    lines.push(rowValues(row, cols).map(csvEscape).join(";"));
  }
  // BOM so Excel on Windows (the Slovenian-locale target audience) opens UTF-8 correctly.
  return "﻿" + lines.join("\r\n");
}

export async function buildXlsx(data: ResolvedExportData): Promise<Buffer> {
  const cols = columns(data.entityTypeColumns);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Documents");

  sheet.columns = cols.map((c) => ({ header: c.label, key: c.key, width: 24 }));

  for (const row of data.rows) {
    const values = rowValues(row, cols);
    sheet.addRow(Object.fromEntries(cols.map((c, i) => [c.key, values[i]])));
  }

  sheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
