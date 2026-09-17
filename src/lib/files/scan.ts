import type { Readable } from "node:stream";
import { Socket } from "node:net";

import { env } from "@/lib/env";
import { ScanUnavailableError } from "@/lib/errors";

export type ScanResult = { infected: boolean; signature: string | null };

const CHUNK_SIZE = 64 * 1024;
const SOCKET_TIMEOUT_MS = 30_000;

// Reply forms: "stream: OK" or "stream: <Signature name> FOUND". Shared by scanBuffer() and
// scanStream() so the two protocol implementations can't drift on how a reply is interpreted.
function parseClamdResponse(chunks: Buffer[]): ScanResult {
  const response = Buffer.concat(chunks).toString("utf8").replace(/\0/g, "").trim();

  if (response.endsWith("ERROR")) {
    throw new ScanUnavailableError(`ClamAV error: ${response}`);
  }

  const found = response.match(/^stream:\s*(.+)\s+FOUND$/);
  return found ? { infected: true, signature: found[1] } : { infected: false, signature: null };
}

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

      try {
        resolve(parseClamdResponse(chunks));
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Same INSTREAM protocol, framing chunks read from a Node stream instead of a pre-buffered
// Buffer — ingest-document.ts scans a file streamed from a temp file, never the whole 100MB
// cap held in worker memory at once (specs/10-nonfunctional.md, and the whole point of Phase 3
// M3's converged ingest pipeline). Framing respects the source stream's own chunk boundaries
// (whatever size Node's fs read stream hands us, default 64KB) rather than re-chunking to
// CHUNK_SIZE — the INSTREAM protocol allows any chunk size per frame.
export function scanStream(source: Readable): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const chunks: Buffer[] = [];
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      source.destroy();
      reject(err);
    };

    socket.setTimeout(SOCKET_TIMEOUT_MS);
    socket.on("timeout", () => fail(new ScanUnavailableError("ClamAV scan timed out")));
    socket.on("error", (err) =>
      fail(new ScanUnavailableError(`ClamAV connection failed: ${err.message}`))
    );
    source.on("error", (err) =>
      fail(new ScanUnavailableError(`Failed to read file for scanning: ${err.message}`))
    );

    socket.connect(env.CLAMAV_PORT, env.CLAMAV_HOST, () => {
      socket.write("zINSTREAM\0");

      source.on("data", (chunk: Buffer) => {
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length, 0);
        socket.write(size);
        // Backpressure: pause the source if the socket's write buffer is saturated, resume on
        // drain — otherwise a slow clamd connection lets the whole file pile up in memory
        // anyway, defeating the point of streaming it in the first place.
        const canContinue = socket.write(chunk);
        if (!canContinue) source.pause();
      });

      socket.on("drain", () => source.resume());

      source.on("end", () => socket.write(Buffer.alloc(4)));
    });

    socket.on("data", (data) => chunks.push(data));
    socket.on("end", () => {
      if (settled) return;
      settled = true;

      try {
        resolve(parseClamdResponse(chunks));
      } catch (err) {
        reject(err);
      }
    });
  });
}
