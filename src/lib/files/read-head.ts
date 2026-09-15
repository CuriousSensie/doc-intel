import { open } from "node:fs/promises";

// Reads the first `maxBytes` of a file without loading the rest — used wherever only a
// header/sniff sample is needed (MIME sniffing in ingest-document.ts, encoding/delimiter
// sniffing in import/parse.ts), never the whole file.
export async function readFileHead(path: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
