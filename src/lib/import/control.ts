import { getRedisClient } from "@/lib/redis";

// specs/06-importer.md: "Cancellation stops scheduling new chunks; in-flight rows complete."
// A Redis flag, not a Postgres read, is what the chunk executor checks before claiming its
// next batch — one GET per chunk (worker/jobs/run-import-chunk.ts) is cheap enough to check
// on every chunk without adding a real query to the hot path, and pause/resume/cancel need to
// take effect for a chunk that's already mid-flight in the queue, not just future ones.
export type ImportControlState = "running" | "paused" | "cancelled";

const TTL_SECONDS = 7 * 24 * 60 * 60; // outlives any single import job; harmless if stale

function controlKey(importJobId: string): string {
  return `import:${importJobId}:control`;
}

export async function setImportControl(importJobId: string, state: ImportControlState): Promise<void> {
  await getRedisClient().set(controlKey(importJobId), state, "EX", TTL_SECONDS);
}

// Defaults to "running" when unset — the very first chunk of a freshly-started job hasn't had
// startImportJob() run any earlier than its own enqueue, so there's no race where a chunk sees
// a stale "no flag" as anything other than "proceed" (setImportControl() is always called
// before any chunk job could plausibly execute).
export async function getImportControl(importJobId: string): Promise<ImportControlState> {
  const value = await getRedisClient().get(controlKey(importJobId));
  return (value as ImportControlState | null) ?? "running";
}

export async function clearImportControl(importJobId: string): Promise<void> {
  await getRedisClient().del(controlKey(importJobId));
}
