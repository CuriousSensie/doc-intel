import { afterEach, describe, expect, it, vi } from "vitest";

describe("runImportChunk", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("does nothing and does not reschedule when the control flag isn't 'running'", async () => {
    vi.doMock("@/lib/import/control", () => ({ getImportControl: vi.fn().mockResolvedValue("paused") }));
    const rpc = vi.fn();
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
    const enqueue = vi.fn();
    vi.doMock("@/lib/queue", () => ({ enqueue, QUEUE_NAMES: { runImportChunk: "run-import-chunk" } }));

    const { runImportChunk } = await import("./run-import-chunk");
    await runImportChunk("org-1", "job-1");

    expect(rpc).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  // Both fetchJob() (.single()) and tryFinalize()'s own read (.maybeSingle()) go through
  // `.from("import_jobs")...` with a different terminal call — this stub answers either.
  function makeAdminStub(jobRow: Record<string, unknown>) {
    const terminal = { single: () => Promise.resolve({ data: jobRow, error: null }), maybeSingle: () => Promise.resolve({ data: jobRow, error: null }) };
    const from = vi.fn(() => ({ select: () => ({ eq: () => ({ eq: () => terminal }) }) }));
    return from;
  }

  it("finalizes the job and sends one summary notification when nothing is left to claim", async () => {
    vi.doMock("@/lib/import/control", () => ({ getImportControl: vi.fn().mockResolvedValue("running") }));

    const rpc = vi.fn((name: string) => {
      if (name === "claim_import_chunk") return Promise.resolve({ data: [], error: null });
      if (name === "complete_import_job") return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const from = makeAdminStub({
      kind: "entities",
      created_by: "user-1",
      source_filename: "customers.csv",
      status: "completed",
      succeeded_rows: 10,
      failed_rows: 0,
      skipped_rows: 0
    });
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from }) }));

    const createNotification = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/modules/notifications/notifications.service", () => ({ createNotification }));
    vi.doMock("@/lib/queue", () => ({ enqueue: vi.fn(), QUEUE_NAMES: { runImportChunk: "run-import-chunk" } }));

    const { runImportChunk } = await import("./run-import-chunk");
    await runImportChunk("org-1", "job-1");

    expect(rpc).toHaveBeenCalledWith(
      "complete_import_job",
      expect.objectContaining({ p_import_job_id: "job-1", p_organization_id: "org-1" })
    );
    expect(createNotification).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ type: "import.completed" })
    );
  });

  it("does not notify when complete_import_job reports the job isn't actually finished yet", async () => {
    vi.doMock("@/lib/import/control", () => ({ getImportControl: vi.fn().mockResolvedValue("running") }));

    const rpc = vi.fn((name: string) => {
      if (name === "claim_import_chunk") return Promise.resolve({ data: [], error: null });
      if (name === "complete_import_job") return Promise.resolve({ data: false, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const from = makeAdminStub({ kind: "entities", created_by: "user-1" });
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from }) }));

    const createNotification = vi.fn();
    vi.doMock("@/modules/notifications/notifications.service", () => ({ createNotification }));
    vi.doMock("@/lib/queue", () => ({ enqueue: vi.fn(), QUEUE_NAMES: { runImportChunk: "run-import-chunk" } }));

    const { runImportChunk } = await import("./run-import-chunk");
    await runImportChunk("org-1", "job-1");

    expect(createNotification).not.toHaveBeenCalled();
  });
});
