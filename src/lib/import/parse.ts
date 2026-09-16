import { createReadStream, createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

import ExcelJS from "exceljs";
import iconv from "iconv-lite";
import { parse as parseCsv } from "csv-parse";
import yauzl from "yauzl";

import { readFileHead } from "@/lib/files/read-head";
import type { DownloadedTempFile } from "@/lib/supabase/storage-stream";

import { decodeBuffer, detectEncoding } from "./encoding";
import { sniffDelimiter, type Delimiter } from "./delimiter";
import { ImportRowError } from "./errors";

// specs/06-importer.md §Parsing: "Formats: .csv, .tsv, .xlsx, .xls." — .xls (legacy binary
// Excel/BIFF) is deliberately not supported. The only maintained parser for it is SheetJS,
// which no longer publishes current versions to the public npm registry (its own docs point
// installs at https://cdn.sheetjs.com instead) and carries a real CVE history — not worth
// adding to a path that parses untrusted customer files for a legacy format. See
// docs/adr/0015-decline-xls-support.md.
export type ImportFileFormat = "csv" | "tsv" | "xlsx" | "zip";

const XLS_REJECTION_MESSAGE =
  'Excel 97-2003 (.xls) is not supported. Open the file in Excel and use "Save As" → .xlsx, then re-upload.';

export function detectImportFileFormat(filename: string): ImportFileFormat {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "xls") {
    throw new ImportRowError("PARSE_ERROR", XLS_REJECTION_MESSAGE);
  }
  if (ext === "csv" || ext === "tsv" || ext === "xlsx" || ext === "zip") {
    return ext;
  }
  throw new ImportRowError("PARSE_ERROR", `Unsupported file type: .${ext || "unknown"}`);
}

// ---------------------------------------------------------------------------------------------
// CSV / TSV — stream, never buffer the whole file. Encoding + delimiter are sniffed from a head
// sample once, then reused for every row so a header-only sniff and a full-file parse never
// disagree on how to read the same bytes.
// ---------------------------------------------------------------------------------------------

const HEAD_SAMPLE_BYTES = 64 * 1024;
const SAMPLE_ROWS_PER_COLUMN = 3;

export type ColumnPreview = {
  index: number;
  header: string;
  sample: string[];
};

export type AnalyzeDelimitedResult = {
  columns: ColumnPreview[];
  rowCount: number;
  encoding: string;
  delimiter: Delimiter;
};

export async function sniffDelimitedFile(
  filePath: string
): Promise<{ encoding: string; delimiter: Delimiter }> {
  const head = await readFileHead(filePath, HEAD_SAMPLE_BYTES);
  const { encoding } = detectEncoding(head);
  const headText = decodeBuffer(head, encoding);
  // First full line only (the sample may end mid-row) — a header line is representative of the
  // whole file's delimiter, and this is the input sniffDelimiter() is documented to want.
  const firstLine = headText.split(/\r?\n/, 2)[0] ?? "";
  const delimiter = sniffDelimiter(firstLine);
  return { encoding, delimiter };
}

// Yields every row (the header included, as the first yielded record) as a string array.
// Never materializes the file — a 200MB spreadsheet stays 200MB on disk, not in the worker's
// heap (specs/10-nonfunctional.md).
export async function* streamDelimitedRows(
  filePath: string,
  options: { encoding: string; delimiter: Delimiter }
): AsyncGenerator<string[]> {
  const parser = createReadStream(filePath)
    .pipe(iconv.decodeStream(options.encoding))
    .pipe(
      parseCsv({
        delimiter: options.delimiter,
        relax_column_count: true,
        skip_empty_lines: true
      })
    );

  for await (const record of parser as AsyncIterable<string[]>) {
    yield record as string[];
  }
}

// specs/06-importer.md §Mapping: analyze() returns columns (with a few sample values), the
// total row count, and the detected encoding/delimiter. Type detection and mapping suggestions
// are the analyze *endpoint's* job (Phase 3 M5) — this is only the mechanical parse.
export async function analyzeDelimitedFile(
  filePath: string,
  maxRows: number,
  overrides: { encoding?: string; delimiter?: Delimiter } = {}
): Promise<AnalyzeDelimitedResult> {
  const detected = await sniffDelimitedFile(filePath);
  const encoding = overrides.encoding ?? detected.encoding;
  // Re-sniff after decoding with the override; incorrect decoding can corrupt delimiters too.
  const delimiter =
    overrides.delimiter ??
    (overrides.encoding
      ? sniffDelimiter(
          decodeBuffer(await readFileHead(filePath, HEAD_SAMPLE_BYTES), encoding).split(
            /\r?\n/,
            2
          )[0] ?? ""
        )
      : detected.delimiter);

  let header: string[] | null = null;
  const samples: string[][] = [];
  let rowCount = 0;

  for await (const record of streamDelimitedRows(filePath, { encoding, delimiter })) {
    if (!header) {
      header = record;
      continue;
    }

    rowCount++;
    // specs/06-importer.md §Parsing: "Row cap MVP: 50,000 rows per job. Above that, instruct
    // splitting." Checked while streaming, not after — never finish parsing a file this large
    // just to reject it.
    if (rowCount > maxRows) {
      throw new ImportRowError(
        "PARSE_ERROR",
        `File has more than ${maxRows} rows — split it into smaller files before importing`
      );
    }

    if (samples.length < SAMPLE_ROWS_PER_COLUMN) samples.push(record);
  }

  if (!header) {
    throw new ImportRowError("PARSE_ERROR", "File has no rows");
  }

  const columns: ColumnPreview[] = header.map((headerName, index) => ({
    index,
    header: headerName,
    sample: samples.map((row) => row[index] ?? "")
  }));

  return { columns, rowCount, encoding, delimiter };
}

// ---------------------------------------------------------------------------------------------
// XLSX — exceljs's streaming reader, never the in-memory Workbook
// (src/modules/exports/file-builders.ts's buildXlsx() is fine to buffer since it only ever
// writes a bounded export; reading an arbitrary customer-supplied spreadsheet is the case
// specs/10-nonfunctional.md's "never load a 200MB spreadsheet into memory" is actually about).
// Always UTF-8 internally — no encoding/delimiter sniffing needed, unlike CSV/TSV.
// ---------------------------------------------------------------------------------------------

// ExcelJS.stream.xlsx.Row#values is 1-indexed with a leading empty slot (row.values[0] is
// always undefined) — every caller wants a plain 0-indexed row, so this is the one place that
// off-by-one is handled.
function normalizeXlsxRowValues(values: ExcelJS.CellValue[]): string[] {
  return values.slice(1).map((value) => {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "object" && "text" in value) return String(value.text ?? "");
    return String(value);
  });
}

export async function* streamXlsxRows(filePath: string): AsyncGenerator<string[]> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {});

  for await (const worksheet of reader) {
    for await (const row of worksheet) {
      yield normalizeXlsxRowValues(row.values as ExcelJS.CellValue[]);
    }
    // Only the first worksheet — specs/06-importer.md's mapping/analyze shapes assume one
    // tabular source per import job, matching the CSV/TSV path's single-stream shape.
    break;
  }
}

export async function analyzeXlsxFile(
  filePath: string,
  maxRows: number
): Promise<Omit<AnalyzeDelimitedResult, "encoding" | "delimiter">> {
  let header: string[] | null = null;
  const samples: string[][] = [];
  let rowCount = 0;

  for await (const record of streamXlsxRows(filePath)) {
    if (!header) {
      header = record;
      continue;
    }

    rowCount++;
    if (rowCount > maxRows) {
      throw new ImportRowError(
        "PARSE_ERROR",
        `File has more than ${maxRows} rows — split it into smaller files before importing`
      );
    }

    if (samples.length < SAMPLE_ROWS_PER_COLUMN) samples.push(record);
  }

  if (!header) {
    throw new ImportRowError("PARSE_ERROR", "File has no rows");
  }

  const columns: ColumnPreview[] = header.map((headerName, index) => ({
    index,
    header: headerName,
    sample: samples.map((row) => row[index] ?? "")
  }));

  return { columns, rowCount };
}

// ---------------------------------------------------------------------------------------------
// ZIP — central-directory listing only (yauzl, lazyEntries). Extracting a matched entry's bytes
// is the row-execution job's concern (Phase 3 M6, against a manifest row's match), not
// analyze()'s — this only needs to know what filenames exist and how big they are.
// ---------------------------------------------------------------------------------------------

export type ZipEntryInfo = { fileName: string; uncompressedSize: number };

export function listZipEntries(filePath: string): Promise<ZipEntryInfo[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);

      const entries: ZipEntryInfo[] = [];
      zipfile.readEntry();

      zipfile.on("entry", (entry) => {
        // Directory entries end in "/" and carry no file content — never a document to match.
        if (!entry.fileName.endsWith("/")) {
          entries.push({ fileName: entry.fileName, uncompressedSize: entry.uncompressedSize });
        }
        zipfile.readEntry();
      });

      zipfile.on("end", () => resolve(entries));
      zipfile.on("error", reject);
    });
  });
}

// Opens a read stream for exactly one named entry — the caller must already know the exact
// fileName (from listZipEntries()); this does no matching of its own (specs/06-importer.md's
// exact/case-insensitive/basename fallback order is the matching-strategy layer's job, not
// the archive reader's).
export function openZipEntryStream(filePath: string, fileName: string): Promise<Readable> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);

      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        if (entry.fileName !== fileName) {
          zipfile.readEntry();
          return;
        }

        zipfile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr) return reject(streamErr);
          resolve(stream);
        });
      });

      zipfile.on("end", () => {
        reject(new ImportRowError("FILE_MISSING_IN_ARCHIVE", `"${fileName}" not found in archive`));
      });
      zipfile.on("error", reject);
    });
  });
}

// Extracts one named entry to a real temp file — for the manifest CSV/XLSX that may live
// inside a "documents" kind archive (analyzeSource(), imports.service.ts), which then needs a
// real file path to hand to analyzeDelimitedFile()/analyzeXlsxFile() the same as any other
// uploaded source. Streamed, same as downloadStorageObjectToTempFile() — never buffers the
// entry in memory even if it's a large spreadsheet.
export async function extractZipEntryToTempFile(
  zipPath: string,
  fileName: string
): Promise<DownloadedTempFile> {
  const stream = await openZipEntryStream(zipPath, fileName);
  const tempPath = join(tmpdir(), `import-manifest-${randomUUID()}`);

  try {
    await pipeline(stream, createWriteStream(tempPath));
  } catch (err) {
    await rm(tempPath, { force: true });
    throw err;
  }

  return { path: tempPath, cleanup: () => rm(tempPath, { force: true }) };
}
