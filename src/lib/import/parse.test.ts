import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ExcelJS from "exceljs";
import iconv from "iconv-lite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import yazl from "yazl";

import {
  analyzeDelimitedFile,
  analyzeXlsxFile,
  detectImportFileFormat,
  listZipEntries,
  openZipEntryStream,
  streamDelimitedRows,
  streamXlsxRows
} from "./parse";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "import-parse-test-"));
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe("detectImportFileFormat", () => {
  it("recognizes csv, tsv, xlsx, zip", () => {
    expect(detectImportFileFormat("a.csv")).toBe("csv");
    expect(detectImportFileFormat("a.tsv")).toBe("tsv");
    expect(detectImportFileFormat("a.xlsx")).toBe("xlsx");
    expect(detectImportFileFormat("a.zip")).toBe("zip");
  });

  it("rejects .xls with an actionable message (ADR-0015)", () => {
    expect(() => detectImportFileFormat("legacy.xls")).toThrow(/Excel 97-2003/);
  });

  it("rejects an unrecognized extension", () => {
    expect(() => detectImportFileFormat("data.txt")).toThrow(/Unsupported file type/);
  });
});

describe("analyzeDelimitedFile / streamDelimitedRows", () => {
  it("parses a Windows-1250, ;-delimited, sl-SI decimal file with correct characters", async () => {
    const path = join(dir, "customers.csv");
    const content =
      "Kupec ID;Ime;Znesek\n1023;Podjetje čšž d.o.o.;1.234,56\n1024;Another ČŠŽ podjetje;2.500,00\n";
    await writeFile(path, iconv.encode(content, "windows-1250"));

    const result = await analyzeDelimitedFile(path, 50_000);

    expect(result.encoding.toLowerCase().replace(/-/g, "")).toBe("windows1250");
    expect(result.delimiter).toBe(";");
    expect(result.rowCount).toBe(2);
    expect(result.columns.map((c) => c.header)).toEqual(["Kupec ID", "Ime", "Znesek"]);
    // The character-fidelity assertion definition-of-done item 6 is actually about: real
    // diacritics survive the encoding round trip, not mojibake.
    expect(result.columns[1].sample[0]).toBe("Podjetje čšž d.o.o.");
    expect(result.columns[2].sample[1]).toBe("2.500,00");
  });

  it("streams every row including the header as the first record", async () => {
    const path = join(dir, "simple.csv");
    await writeFile(path, "a;b\n1;2\n3;4\n");

    const rows: string[][] = [];
    for await (const row of streamDelimitedRows(path, { encoding: "utf8", delimiter: ";" })) {
      rows.push(row);
    }

    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"]
    ]);
  });

  it("enforces the row cap while streaming, not after finishing", async () => {
    const rows = ["header"];
    for (let i = 0; i < 10; i++) rows.push(`row${i}`);
    const path = join(dir, "big.csv");
    await writeFile(path, rows.join("\n") + "\n");

    await expect(analyzeDelimitedFile(path, 5)).rejects.toThrow(/more than 5 rows/);
  });

  it("rejects an empty file", async () => {
    const path = join(dir, "empty.csv");
    await writeFile(path, "");
    await expect(analyzeDelimitedFile(path, 50_000)).rejects.toThrow(/no rows/);
  });
});

describe("analyzeXlsxFile / streamXlsxRows", () => {
  it("parses a real .xlsx workbook, preserving numeric and diacritic values", async () => {
    const path = join(dir, "customers.xlsx");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.addRow(["Kupec ID", "Ime", "Znesek"]);
    sheet.addRow([1023, "Podjetje čšž d.o.o.", 1234.56]);
    sheet.addRow([1024, "Another ČŠŽ", 2500]);
    await workbook.xlsx.writeFile(path);

    const result = await analyzeXlsxFile(path, 50_000);

    expect(result.rowCount).toBe(2);
    expect(result.columns.map((c) => c.header)).toEqual(["Kupec ID", "Ime", "Znesek"]);
    expect(result.columns[1].sample[0]).toBe("Podjetje čšž d.o.o.");
    expect(result.columns[2].sample[1]).toBe("2500");
  });

  it("streams rows as plain string arrays", async () => {
    const path = join(dir, "simple.xlsx");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.addRow(["a", "b"]);
    sheet.addRow([1, 2]);
    await workbook.xlsx.writeFile(path);

    const rows: string[][] = [];
    for await (const row of streamXlsxRows(path)) rows.push(row);

    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"]
    ]);
  });
});

describe("listZipEntries / openZipEntryStream", () => {
  async function writeTestZip(): Promise<string> {
    // yauzl only reads archives — yazl (same author, sibling package) is the test-only writer
    // that builds a real ZIP fixture rather than hand-rolling the format or shelling out to a
    // system `zip` binary that may not exist in every CI image.
    const path = join(dir, "documents.zip");
    const zipfile = new yazl.ZipFile();
    zipfile.addBuffer(Buffer.from("invoice one"), "invoice-1.pdf");
    zipfile.addBuffer(Buffer.from("invoice two"), "subfolder/invoice-2.pdf");
    const { createWriteStream } = await import("node:fs");
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(path);
      zipfile.outputStream.pipe(out).on("close", resolve).on("error", reject);
      zipfile.end();
    });
    return path;
  }

  it("lists real archive entries with their uncompressed sizes", async () => {
    const path = await writeTestZip();
    const entries = await listZipEntries(path);

    expect(entries).toEqual(
      expect.arrayContaining([
        { fileName: "invoice-1.pdf", uncompressedSize: "invoice one".length },
        { fileName: "subfolder/invoice-2.pdf", uncompressedSize: "invoice two".length }
      ])
    );
  });

  it("streams a named entry's real bytes", async () => {
    const path = await writeTestZip();
    const stream = await openZipEntryStream(path, "invoice-1.pdf");

    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString("utf8")).toBe("invoice one");
  });

  it("rejects a missing entry with FILE_MISSING_IN_ARCHIVE", async () => {
    const path = await writeTestZip();
    await expect(openZipEntryStream(path, "does-not-exist.pdf")).rejects.toMatchObject({
      code: "FILE_MISSING_IN_ARCHIVE"
    });
  });
});

describe("explicit file settings", () => {
  it("honors the user's encoding and delimiter in both headers and sample values", async () => {
    const path = join(dir, "override.csv");
    await writeFile(path, iconv.encode("Ime\tMesto\nČebelica\tŽalec\n", "UTF-16LE"));
    const result = await analyzeDelimitedFile(path, 50000, {
      encoding: "UTF-16LE",
      delimiter: "\t"
    });
    expect(result.encoding).toBe("UTF-16LE");
    expect(result.delimiter).toBe("\t");
    expect(result.columns).toEqual([
      { index: 0, header: "Ime", sample: ["Čebelica"] },
      { index: 1, header: "Mesto", sample: ["Žalec"] }
    ]);
    expect(result.rowCount).toBe(1);
  });
});
