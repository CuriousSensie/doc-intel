import { getRedisClient } from "@/lib/redis";

// Tracks Paperless task ids that ingest-document.ts has submitted but not yet resolved, so
// poll-paperless-tasks.ts can check on them without a document_uploads scan. Redis, not
// Postgres: this is transient coordination state (never the correctness source — Paperless
// itself and the reconciliation sweep are), and it needs to be cheap to touch on every ingest
// and every poll tick.
//
// One Redis hash per org (task_id -> JSON payload) plus one set of org ids with anything
// pending, so the poller never has to SCAN all of Redis to find work.

const ACTIVE_ORGS_KEY = "paperless:tasks:orgs";

function tasksKey(orgId: string): string {
  return `paperless:tasks:${orgId}`;
}

export type TrackedPaperlessTask = {
  uploadId: string | null;
  submittedAt: number;
};

export async function trackPendingPaperlessTask(
  orgId: string,
  taskId: string,
  uploadId: string | null
): Promise<void> {
  const redis = getRedisClient();
  const payload: TrackedPaperlessTask = { uploadId, submittedAt: Date.now() };

  await redis
    .multi()
    .hset(tasksKey(orgId), taskId, JSON.stringify(payload))
    .sadd(ACTIVE_ORGS_KEY, orgId)
    .exec();
}

export async function listOrgsWithPendingPaperlessTasks(): Promise<string[]> {
  return getRedisClient().smembers(ACTIVE_ORGS_KEY);
}

export async function listPendingPaperlessTasks(
  orgId: string
): Promise<Map<string, TrackedPaperlessTask>> {
  const raw = await getRedisClient().hgetall(tasksKey(orgId));
  const map = new Map<string, TrackedPaperlessTask>();

  for (const [taskId, json] of Object.entries(raw)) {
    try {
      map.set(taskId, JSON.parse(json) as TrackedPaperlessTask);
    } catch {
      // Malformed entry (shouldn't happen — we're the only writer) — drop it rather than crash
      // the whole tick over one bad row.
    }
  }

  return map;
}

// Removes resolved/abandoned task ids for one org, and drops the org from the active set once
// nothing is left — keeps listOrgsWithPendingPaperlessTasks() cheap indefinitely rather than
// accumulating orgs that had a burst of imports months ago.
export async function untrackPaperlessTasks(orgId: string, taskIds: string[]): Promise<void> {
  const redis = getRedisClient();

  if (taskIds.length > 0) {
    await redis.hdel(tasksKey(orgId), ...taskIds);
  }

  const remaining = await redis.hlen(tasksKey(orgId));
  if (remaining === 0) {
    await redis.srem(ACTIVE_ORGS_KEY, orgId);
  }
}
