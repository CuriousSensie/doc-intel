import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";

import { requireEnv } from "@/lib/env";

export type DownloadedTempFile = {
  path: string;
  cleanup: () => Promise<void>;
};

// @supabase/storage-js's own `.download()` (BlobDownloadBuilder, storage-js's
// StorageFileApi.ts) buffers the entire object into a Blob via fetch before handing it back —
// fine for the avatar upload path's small files, not for a 100MB document processed at
// worker concurrency 8 (validate-upload.ts used to do this download, twice, per document).
// This bypasses storage-js and streams the object straight to a temp file instead, so worker
// memory stays bounded regardless of file size or concurrency (specs/10-nonfunctional.md:
// never load a large file into memory).
export async function downloadStorageObjectToTempFile(
  bucket: string,
  storagePath: string
): Promise<DownloadedTempFile> {
  const baseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const encodedPath = storagePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  const res = await fetch(`${baseUrl}/storage/v1/object/${bucket}/${encodedPath}`, {
    headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey }
  });

  if (!res.ok || !res.body) {
    throw new Error(
      `Storage download failed for ${bucket}/${storagePath}: ${res.status} ${res.statusText}`
    );
  }

  const tempPath = join(tmpdir(), `ingest-${randomUUID()}`);

  try {
    // tsconfig's "dom" lib shadows the global ReadableStream type with the browser one;
    // Readable.fromWeb() wants node:stream/web's — same shape at runtime, cast to match.
    const nodeBody = res.body as unknown as NodeWebReadableStream<Uint8Array>;
    await pipeline(Readable.fromWeb(nodeBody), createWriteStream(tempPath));
  } catch (err) {
    await rm(tempPath, { force: true });
    throw err;
  }

  return {
    path: tempPath,
    cleanup: () => rm(tempPath, { force: true })
  };
}
