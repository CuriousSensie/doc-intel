import { importsConfig } from "@/config/imports";
import { detectImportFileFormat, listZipEntries, type ZipEntryInfo } from "@/lib/import/parse";
import { downloadStorageObjectToTempFile, type DownloadedTempFile } from "@/lib/supabase/storage-stream";

import type { ImportJob } from "./imports.service";

export type OpenedJobArchive = { entries: ZipEntryInfo[]; tempFile: DownloadedTempFile };

// Shared by validateImportJob() (only needs the entry list, closes the temp file immediately)
// and run-import-chunk.ts (needs the temp file itself, to extract a matched entry's bytes —
// kept open for the whole chunk, closed by the caller once every row's archive read is done).
// Returns null for anything that isn't a "documents" kind job sourced from a real ZIP archive
// (checksum/paperless_id-matched metadata/re-import jobs have no archive at all).
export async function openJobArchive(job: ImportJob): Promise<OpenedJobArchive | null> {
  if (job.kind !== "documents" || !job.storage_key || !job.source_filename) return null;
  if (detectImportFileFormat(job.source_filename) !== "zip") return null;

  const tempFile = await downloadStorageObjectToTempFile(importsConfig.bucket, job.storage_key);
  const allEntries = await listZipEntries(tempFile.path);
  // A root-level manifest (analyzeSource()'s own rule) is never itself a document to import.
  const manifestEntry = allEntries.find(
    (entry) => !entry.fileName.includes("/") && /\.(csv|tsv|xlsx)$/i.test(entry.fileName)
  );
  const entries = manifestEntry
    ? allEntries.filter((entry) => entry.fileName !== manifestEntry.fileName)
    : allEntries;

  return { entries, tempFile };
}
