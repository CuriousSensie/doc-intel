import type { PaperlessClient } from "./client";
import type { PaperlessListEnvelope, PaperlessTask } from "./types";

// post_document/'s response body is a bare quoted task-id string (confirmed live,
// docs/spike-findings.md), not JSON — strip the surrounding quotes before using it anywhere
// (as a paperless_task_id column value or a /api/tasks/ query param).
export function parsePostDocumentTaskId(rawResponse: string): string {
  return rawResponse.trim().replace(/^"|"$/g, "");
}

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_MAX_ATTEMPTS = 30; // ~60s — same budget the isolation spike verified consumption completes within.

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// Fixed-interval poll, not exponential backoff — this waits for Paperless's async consumption
// to finish, it isn't retrying a failed call (PaperlessClient's own backoff() already covers
// that for each individual GET). Returns null on timeout so callers can distinguish "still
// processing, try again later" from "failed" without throwing on a merely-slow document.
export async function pollPaperlessTask(
  client: PaperlessClient,
  taskId: string,
  options: { intervalMs?: number; maxAttempts?: number } = {}
): Promise<PaperlessTask | null> {
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(intervalMs);

    const envelope = await client.get<PaperlessListEnvelope<PaperlessTask>>(
      `/api/tasks/?task_id=${encodeURIComponent(taskId)}`
    );
    const task = envelope.results[0];

    if (task?.status === "success" || task?.status === "failure") {
      return task;
    }
  }

  return null;
}
