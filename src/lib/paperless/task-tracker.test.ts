import { afterEach, describe, expect, it, vi } from "vitest";

describe("paperless task tracker", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("tracks a task under the org's hash and marks the org active", async () => {
    const hset = vi.fn();
    const sadd = vi.fn();
    const exec = vi.fn().mockResolvedValue([]);
    const multi = vi.fn(() => ({ hset, sadd, exec }));
    hset.mockReturnValue({ sadd, exec });
    sadd.mockReturnValue({ exec });

    vi.doMock("@/lib/redis", () => ({ getRedisClient: () => ({ multi }) }));

    const { trackPendingPaperlessTask } = await import("@/lib/paperless/task-tracker");
    await trackPendingPaperlessTask("org-1", "task-1", "upload-1");

    expect(multi).toHaveBeenCalled();
    expect(hset).toHaveBeenCalledWith(
      "paperless:tasks:org-1",
      "task-1",
      expect.stringContaining('"uploadId":"upload-1"')
    );
    expect(sadd).toHaveBeenCalledWith("paperless:tasks:orgs", "org-1");
  });

  it("lists pending tasks parsed back out of the hash, skipping malformed entries", async () => {
    const hgetall = vi.fn().mockResolvedValue({
      "task-1": JSON.stringify({ uploadId: "upload-1", submittedAt: 123 }),
      "task-2": "not json"
    });
    vi.doMock("@/lib/redis", () => ({ getRedisClient: () => ({ hgetall }) }));

    const { listPendingPaperlessTasks } = await import("@/lib/paperless/task-tracker");
    const pending = await listPendingPaperlessTasks("org-1");

    expect(pending.size).toBe(1);
    expect(pending.get("task-1")).toEqual({ uploadId: "upload-1", submittedAt: 123 });
  });

  it("drops the org from the active set once its hash is empty", async () => {
    const hdel = vi.fn().mockResolvedValue(1);
    const hlen = vi.fn().mockResolvedValue(0);
    const srem = vi.fn().mockResolvedValue(1);
    vi.doMock("@/lib/redis", () => ({ getRedisClient: () => ({ hdel, hlen, srem }) }));

    const { untrackPaperlessTasks } = await import("@/lib/paperless/task-tracker");
    await untrackPaperlessTasks("org-1", ["task-1"]);

    expect(hdel).toHaveBeenCalledWith("paperless:tasks:org-1", "task-1");
    expect(srem).toHaveBeenCalledWith("paperless:tasks:orgs", "org-1");
  });

  it("keeps the org active when tasks remain after untracking", async () => {
    const hdel = vi.fn().mockResolvedValue(1);
    const hlen = vi.fn().mockResolvedValue(2);
    const srem = vi.fn();
    vi.doMock("@/lib/redis", () => ({ getRedisClient: () => ({ hdel, hlen, srem }) }));

    const { untrackPaperlessTasks } = await import("@/lib/paperless/task-tracker");
    await untrackPaperlessTasks("org-1", ["task-1"]);

    expect(srem).not.toHaveBeenCalled();
  });
});
