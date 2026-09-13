import { Socket } from "node:net";

import { env } from "@/lib/env";
import { ScanUnavailableError } from "@/lib/errors";

export type ScanResult = { infected: boolean; signature: string | null };

const CHUNK_SIZE = 64 * 1024;
const SOCKET_TIMEOUT_MS = 30_000;

// Hand-rolled clamd INSTREAM client (no dependency — the protocol is a handful of lines and has
// been stable since ClamAV 0.95): a "zINSTREAM\0" command, then the file as 4-byte-big-endian-
// length-prefixed chunks terminated by a zero-length chunk, then a single text reply line.
export function scanBuffer(buffer: Buffer): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const chunks: Buffer[] = [];
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(err);
    };

    socket.setTimeout(SOCKET_TIMEOUT_MS);
    socket.on("timeout", () => fail(new ScanUnavailableError("ClamAV scan timed out")));
    socket.on("error", (err) =>
      fail(new ScanUnavailableError(`ClamAV connection failed: ${err.message}`))
    );

    socket.connect(env.CLAMAV_PORT, env.CLAMAV_HOST, () => {
      socket.write("zINSTREAM\0");

      for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
        const chunk = buffer.subarray(offset, offset + CHUNK_SIZE);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length, 0);
        socket.write(size);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });

    socket.on("data", (data) => chunks.push(data));
    socket.on("end", () => {
      if (settled) return;
      settled = true;

      const response = Buffer.concat(chunks).toString("utf8").replace(/\0/g, "").trim();

      if (response.endsWith("ERROR")) {
        reject(new ScanUnavailableError(`ClamAV error: ${response}`));
        return;
      }

      // Reply forms: "stream: OK" or "stream: <Signature name> FOUND".
      const found = response.match(/^stream:\s*(.+)\s+FOUND$/);
      resolve(
        found ? { infected: true, signature: found[1] } : { infected: false, signature: null }
      );
    });
  });
}
