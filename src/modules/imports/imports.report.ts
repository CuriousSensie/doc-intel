import type { ServiceContext } from "@/lib/service-context";

import type { ImportRow } from "./imports.service";

// sl-SI delimiter is ';' and a UTF-8 BOM for Excel-on-Windows — same convention as
// src/modules/exports/file-builders.ts's buildCsv(), duplicated rather than imported since
// it's a single small function and the two report shapes are otherwise unrelated.
function csvEscape(value: string): string {
  if (value.includes(";") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const REPORT_PAGE_SIZE = 500;

// specs/06-importer.md §Reporting: "row number, status, error code, human message, created/
// matched ids, and the original row echoed back so the customer can fix and re-upload only the
// failures." Streams pages of import_rows rather than loading the whole job's rows at once —
// the same reason nothing else in this pipeline buffers a whole file.
export async function buildImportReportCsv(ctx: ServiceContext, importJobId: string): Promise<string> {
  const header = ["row_number", "status", "error_code", "error_message", "result", "raw"];
  const lines = [header.map(csvEscape).join(";")];

  let lastId = 0;
  for (;;) {
    const { data, error } = await ctx.db
      .from("import_rows")
      .select("id, row_number, status, error_code, error_message, result, raw")
      .eq("organization_id", ctx.orgId)
      .eq("import_job_id", importJobId)
      .gt("id", lastId)
      .order("id", { ascending: true })
      .limit(REPORT_PAGE_SIZE);
    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) {
      lines.push(rowToCsvLine(row));
    }
    lastId = data[data.length - 1].id;
  }

  return "﻿" + lines.join("\r\n");
}

function rowToCsvLine(row: Pick<ImportRow, "row_number" | "status" | "error_code" | "error_message" | "result" | "raw">): string {
  const cells = [
    String(row.row_number),
    row.status,
    row.error_code ?? "",
    row.error_message ?? "",
    row.result ? JSON.stringify(row.result) : "",
    JSON.stringify(row.raw)
  ];
  return cells.map(csvEscape).join(";");
}
