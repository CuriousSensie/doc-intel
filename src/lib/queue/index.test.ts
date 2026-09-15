import { afterEach, describe, expect, it, vi } from "vitest";

describe("queue helpers", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("applies retention and lane priority defaults when creating queues", async () => {
    const add = vi.fn();
    const addBulk = vi.fn();
    const queueCtor = vi.fn().mockImplementation(() => ({ add, addBulk }));

    vi.doMock("bullmq", () => ({ Queue: queueCtor }));
    vi.doMock("@/lib/redis", () => ({ getRedisClient: () => ({}) }));

    const { getQueue, QUEUE_NAMES } = await import("@/lib/queue");

    getQueue(QUEUE_NAMES.ingestDocument);

    expect(queueCtor).toHaveBeenCalledWith(
      "ingest-document",
      expect.objectContaining({
        defaultJobOptions: expect.objectContaining({
          attempts: 3,
          priority: 1,
          removeOnComplete: { age: 86_400, count: 1_000 },
          removeOnFail: { age: 604_800, count: 1_000 }
        })
      })
    );
  });

  it("adds many jobs through BullMQ addBulk with shared options", async () => {
    const add = vi.fn();
    const addBulk = vi.fn().mockResolvedValue([]);
    const queueCtor = vi.fn().mockImplementation(() => ({ add, addBulk }));

    vi.doMock("bullmq", () => ({ Queue: queueCtor }));
    vi.doMock("@/lib/redis", () => ({ getRedisClient: () => ({}) }));

    const { enqueueBulk, QUEUE_NAMES } = await import("@/lib/queue");

    await enqueueBulk(QUEUE_NAMES.runImportChunk, [{ orgId: "org-1", rowId: 1 }], { priority: 10 });

    expect(addBulk).toHaveBeenCalledWith([
      {
        name: "run-import-chunk",
        data: { orgId: "org-1", rowId: 1 },
        opts: { priority: 10 }
      }
    ]);
    expect(add).not.toHaveBeenCalled();
  });
});
