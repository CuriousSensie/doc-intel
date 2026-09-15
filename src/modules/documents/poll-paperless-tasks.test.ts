import { afterEach, describe, expect, it, vi } from "vitest";

describe("pollPaperlessTasks", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  function mockAdminUpdateChain() {
    const eqStatus = vi.fn().mockResolvedValue({ error: null });
    const eqOrg = vi.fn(() => ({ in: eqStatus }));
    const eqId = vi.fn(() => ({ eq: eqOrg }));
    const update = vi.fn(() => ({ eq: eqId }));
    return { update, eqId, eqOrg, eqStatus };
  }

  it("enqueues sync-paperless-document and untracks the task on success", async () => {
    vi.doMock("@/lib/paperless/task-tracker", () => ({
      listOrgsWithPendingPaperlessTasks: vi.fn().mockResolvedValue(["org-1"]),
      listPendingPaperlessTasks: vi
        .fn()
        .mockResolvedValue(new Map([["task-1", { uploadId: "upload-1", submittedAt: Date.now() }]])),
      untrackPaperlessTasks: vi.fn().mockResolvedValue(undefined)
    }));

    const get = vi.fn().mockResolvedValue({
      results: [
        {
          task_id: "task-1",
          status: "success",
          related_document_ids: [42],
          result_data: null
        }
      ]
    });
    const setOwnedObjectPermissions = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/paperless/client", () => ({
      paperlessFor: vi.fn().mockResolvedValue({
        get,
        ownership: { ownerId: 1, groupId: 2 },
        setOwnedObjectPermissions
      })
    }));

    const enqueue = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/queue", () => ({
      enqueue,
      QUEUE_NAMES: { syncPaperlessDocument: "sync-paperless-document" }
    }));
    vi.doMock("@/lib/queue/config", () => ({ QUEUE_PRIORITY: { interactiveUpload: 1 } }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

    const { untrackPaperlessTasks } = await import("@/lib/paperless/task-tracker");
    const { pollPaperlessTasks } = await import("@/modules/documents/poll-paperless-tasks");

    await pollPaperlessTasks();

    expect(get).toHaveBeenCalledWith("/api/tasks/?task_id=task-1");
    expect(setOwnedObjectPermissions).toHaveBeenCalledWith("/api/documents/42/", {
      ownerId: 1,
      groupId: 2
    });
    expect(enqueue).toHaveBeenCalledWith(
      "sync-paperless-document",
      { orgId: "org-1", uploadId: "upload-1", paperlessDocumentId: 42 },
      { priority: 1 }
    );
    expect(untrackPaperlessTasks).toHaveBeenCalledWith("org-1", ["task-1"]);
  });

  it("marks the upload failed and untracks on a failed task", async () => {
    vi.doMock("@/lib/paperless/task-tracker", () => ({
      listOrgsWithPendingPaperlessTasks: vi.fn().mockResolvedValue(["org-1"]),
      listPendingPaperlessTasks: vi
        .fn()
        .mockResolvedValue(new Map([["task-1", { uploadId: "upload-1", submittedAt: Date.now() }]])),
      untrackPaperlessTasks: vi.fn().mockResolvedValue(undefined)
    }));

    const get = vi.fn().mockResolvedValue({
      results: [{ task_id: "task-1", status: "failure", related_document_ids: [], result_data: "boom" }]
    });
    vi.doMock("@/lib/paperless/client", () => ({
      paperlessFor: vi.fn().mockResolvedValue({ get, ownership: null })
    }));
    vi.doMock("@/lib/queue", () => ({ enqueue: vi.fn(), QUEUE_NAMES: {} }));
    vi.doMock("@/lib/queue/config", () => ({ QUEUE_PRIORITY: { interactiveUpload: 1 } }));

    const { update, eqStatus } = mockAdminUpdateChain();
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ update }) }) }));

    const { untrackPaperlessTasks } = await import("@/lib/paperless/task-tracker");
    const { pollPaperlessTasks } = await import("@/modules/documents/poll-paperless-tasks");

    await pollPaperlessTasks();

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error_message: expect.stringContaining("boom") })
    );
    expect(eqStatus).toHaveBeenCalledWith("status", ["processing"]);
    expect(untrackPaperlessTasks).toHaveBeenCalledWith("org-1", ["task-1"]);
  });

  it("fails a stale task past its window instead of leaving it tracked forever", async () => {
    const staleSubmittedAt = Date.now() - 60 * 60 * 1000;
    vi.doMock("@/lib/paperless/task-tracker", () => ({
      listOrgsWithPendingPaperlessTasks: vi.fn().mockResolvedValue(["org-1"]),
      listPendingPaperlessTasks: vi
        .fn()
        .mockResolvedValue(
          new Map([["task-1", { uploadId: "upload-1", submittedAt: staleSubmittedAt }]])
        ),
      untrackPaperlessTasks: vi.fn().mockResolvedValue(undefined)
    }));

    const get = vi.fn().mockResolvedValue({ results: [{ task_id: "task-1", status: "started" }] });
    vi.doMock("@/lib/paperless/client", () => ({
      paperlessFor: vi.fn().mockResolvedValue({ get, ownership: null })
    }));
    vi.doMock("@/lib/queue", () => ({ enqueue: vi.fn(), QUEUE_NAMES: {} }));
    vi.doMock("@/lib/queue/config", () => ({ QUEUE_PRIORITY: { interactiveUpload: 1 } }));

    const { update } = mockAdminUpdateChain();
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ update }) }) }));

    const { untrackPaperlessTasks } = await import("@/lib/paperless/task-tracker");
    const { pollPaperlessTasks } = await import("@/modules/documents/poll-paperless-tasks");

    await pollPaperlessTasks();

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error_message: expect.stringContaining("did not report completion")
      })
    );
    expect(untrackPaperlessTasks).toHaveBeenCalledWith("org-1", ["task-1"]);
  });

  it("leaves an unresolved, non-stale task tracked and moves on to the next tick", async () => {
    vi.doMock("@/lib/paperless/task-tracker", () => ({
      listOrgsWithPendingPaperlessTasks: vi.fn().mockResolvedValue(["org-1"]),
      listPendingPaperlessTasks: vi
        .fn()
        .mockResolvedValue(new Map([["task-1", { uploadId: "upload-1", submittedAt: Date.now() }]])),
      untrackPaperlessTasks: vi.fn().mockResolvedValue(undefined)
    }));

    const get = vi.fn().mockResolvedValue({ results: [{ task_id: "task-1", status: "started" }] });
    vi.doMock("@/lib/paperless/client", () => ({
      paperlessFor: vi.fn().mockResolvedValue({ get, ownership: null })
    }));
    vi.doMock("@/lib/queue", () => ({ enqueue: vi.fn(), QUEUE_NAMES: {} }));
    vi.doMock("@/lib/queue/config", () => ({ QUEUE_PRIORITY: { interactiveUpload: 1 } }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

    const { untrackPaperlessTasks } = await import("@/lib/paperless/task-tracker");
    const { pollPaperlessTasks } = await import("@/modules/documents/poll-paperless-tasks");

    await pollPaperlessTasks();

    expect(untrackPaperlessTasks).toHaveBeenCalledWith("org-1", []);
  });

  it("keeps polling other orgs when one org's poll throws", async () => {
    vi.doMock("@/lib/paperless/task-tracker", () => ({
      listOrgsWithPendingPaperlessTasks: vi.fn().mockResolvedValue(["org-broken", "org-ok"]),
      listPendingPaperlessTasks: vi.fn((orgId: string) =>
        orgId === "org-broken"
          ? Promise.reject(new Error("paperless down"))
          : Promise.resolve(new Map([["task-1", { uploadId: null, submittedAt: Date.now() }]]))
      ),
      untrackPaperlessTasks: vi.fn().mockResolvedValue(undefined)
    }));

    const get = vi.fn().mockResolvedValue({ results: [{ task_id: "task-1", status: "started" }] });
    vi.doMock("@/lib/paperless/client", () => ({
      paperlessFor: vi.fn().mockResolvedValue({ get, ownership: null })
    }));
    vi.doMock("@/lib/queue", () => ({ enqueue: vi.fn(), QUEUE_NAMES: {} }));
    vi.doMock("@/lib/queue/config", () => ({ QUEUE_PRIORITY: { interactiveUpload: 1 } }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

    const { listPendingPaperlessTasks } = await import("@/lib/paperless/task-tracker");
    const { pollPaperlessTasks } = await import("@/modules/documents/poll-paperless-tasks");

    await expect(pollPaperlessTasks()).resolves.toBeUndefined();
    expect(listPendingPaperlessTasks).toHaveBeenCalledWith("org-broken");
    expect(listPendingPaperlessTasks).toHaveBeenCalledWith("org-ok");
  });
});
