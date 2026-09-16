import { afterEach, describe, expect, it, vi } from "vitest";

// Regression coverage for a real bug caught during Phase 3 M6 live verification (not by any
// unit test — the mocked plan-resolution tests never exercise the actual claim_import_chunk
// query): validateImportJob() used to write the *real* terminal status (e.g. "ok") to
// import_rows.status for every row with an executable plan. That's the exact same column
// claim_import_chunk() reads to find pending work — so after validating, the real run's chunk
// executor had nothing left in "pending" to claim, and every import silently stalled at
// processed_rows=0 forever. Only a genuinely bad plan ("error" action) should ever get a
// terminal status from validate(); everything else must stay "pending" so the real run still
// executes it.
describe("validateImportJob — row status semantics", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("writes 'pending' (never 'ok') for an executable create/update plan, and a terminal status only for a genuine error", async () => {
    const job = {
      id: "job-1",
      organization_id: "org-1",
      kind: "entities",
      status: "mapping",
      mapping: {
        entityTypeKey: "customer",
        displayNameColumn: 1,
        identifierColumns: [{ kind: "vat", column: 0 }],
        fields: []
      }
    };

    vi.doMock("@/modules/imports/imports.matching", () => ({
      resolveEntityRowPlans: vi.fn().mockResolvedValue(
        new Map([
          [1, { action: "create", entityTypeId: "et-1", displayName: "Acme", data: {} }],
          [2, { action: "error", code: "MISSING_REQUIRED", message: "no name" }]
        ])
      ),
      resolveDocumentRowPlans: vi.fn()
    }));
    vi.doMock("@/modules/imports/imports.archive", () => ({ openJobArchive: vi.fn() }));

    const capturedUpdateCalls: unknown[] = [];
    const jobUpdates: Record<string, unknown>[] = [];
    let importRowsPage = 0;

    const rpc = vi.fn((name: string, args: unknown) => {
      if (name === "bulk_update_import_rows") {
        capturedUpdateCalls.push(args);
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const from = vi.fn((table: string) => {
      if (table === "import_jobs") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: job, error: null }) })
            })
          }),
          update: (update: Record<string, unknown>) => {
            jobUpdates.push(update);
            return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
          }
        };
      }
      if (table === "import_rows") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                gt: () => ({
                  order: () => ({
                    limit: () => {
                      importRowsPage++;
                      if (importRowsPage === 1) {
                        return Promise.resolve({
                          data: [
                            { id: 1, row_number: 1, raw: ["SI111", "Acme"] },
                            { id: 2, row_number: 2, raw: ["SI222", ""] }
                          ],
                          error: null
                        });
                      }
                      return Promise.resolve({ data: [], error: null });
                    }
                  })
                })
              })
            })
          })
        };
      }
      // logEvent()'s audit_log sink — not the point of this test, just needs to not throw.
      return { insert: () => Promise.resolve({ error: null }) };
    });

    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from }) }));

    const { validateImportJob } = await import("./imports.service");
    const ctx = {
      db: membershipDb() as never,
      orgId: "org-1",
      actorId: "user-1",
      correlationId: "corr-1"
    };

    const summary = await validateImportJob(ctx, "job-1");

    expect(summary).toEqual({ ok: 1, skippedDuplicate: 0, needsReview: 0, failed: 1 });
    expect(jobUpdates.find((update) => update.status === "ready")).toMatchObject({
      processed_rows: 1,
      failed_rows: 1,
      options: { validation: summary }
    });

    const rows = (capturedUpdateCalls[0] as { p_rows: Array<{ id: number; status: string }> })
      .p_rows;
    expect(rows.find((r) => r.id === 1)?.status).toBe("pending");
    expect(rows.find((r) => r.id === 2)?.status).toBe("failed");
  });

  it("counts reviewable executable plans without removing them from the run queue", async () => {
    const job = {
      id: "job-1",
      organization_id: "org-1",
      kind: "metadata_only",
      status: "mapping",
      mapping: {
        documentBy: { strategy: "filename", column: 0 },
        fields: [],
        entityLinks: []
      }
    };

    vi.doMock("@/modules/imports/imports.matching", () => ({
      resolveEntityRowPlans: vi.fn(),
      resolveDocumentRowPlans: vi.fn().mockResolvedValue(
        new Map([
          [
            1,
            {
              action: "connect_existing",
              documentId: "doc-1",
              paperlessDocumentId: 42,
              fieldWrites: [],
              entityLinks: [{ outcome: "skipped", relation: "issued_to" }],
              needsReview: true,
              reviewCode: "ENTITY_NOT_FOUND",
              reviewMessage: "One or more entity links were skipped"
            }
          ]
        ])
      )
    }));
    vi.doMock("@/modules/imports/imports.archive", () => ({ openJobArchive: vi.fn() }));

    const capturedUpdateCalls: unknown[] = [];
    const jobUpdates: Record<string, unknown>[] = [];
    let importRowsPage = 0;
    const rpc = vi.fn((name: string, args: unknown) => {
      if (name === "bulk_update_import_rows") capturedUpdateCalls.push(args);
      return Promise.resolve({ data: null, error: null });
    });
    const from = vi.fn((table: string) => {
      if (table === "import_jobs") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: job, error: null }) })
            })
          }),
          update: (update: Record<string, unknown>) => {
            jobUpdates.push(update);
            return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
          }
        };
      }
      if (table === "import_rows") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                gt: () => ({
                  order: () => ({
                    limit: () => {
                      importRowsPage++;
                      return Promise.resolve({
                        data:
                          importRowsPage === 1
                            ? [{ id: 1, row_number: 1, raw: ["invoice.pdf", "missing-vat"] }]
                            : [],
                        error: null
                      });
                    }
                  })
                })
              })
            })
          })
        };
      }
      return { insert: () => Promise.resolve({ error: null }) };
    });
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from }) }));

    const { validateImportJob } = await import("./imports.service");
    const summary = await validateImportJob(
      {
        db: membershipDb() as never,
        orgId: "org-1",
        actorId: "user-1",
        correlationId: "corr-1"
      },
      "job-1"
    );

    expect(summary).toEqual({
      ok: 0,
      skippedDuplicate: 0,
      needsReview: 1,
      failed: 0,
      unmatched: 1
    });
    expect(jobUpdates.find((update) => update.status === "ready")).toMatchObject({
      processed_rows: 1,
      failed_rows: 1,
      options: { validation: summary }
    });
    const rows = (capturedUpdateCalls[0] as { p_rows: Array<{ id: number; status: string }> })
      .p_rows;
    expect(rows[0]).toMatchObject({
      status: "pending",
      error_code: "ENTITY_NOT_FOUND"
    });
  });
});

describe("retryFailedRows — progress accounting", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("uses the exact affected count beyond the response-row cap and preserves conflicts", async () => {
    const updateJob = vi.fn(() => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }));
    const updateRows = vi.fn(() => ({
      eq: () => ({
        eq: () => ({ eq: () => Promise.resolve({ count: 1200, data: null, error: null }) })
      })
    }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: (table: string) =>
          table === "import_rows"
            ? { update: updateRows }
            : {
                select: () => ({
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: () =>
                        Promise.resolve({
                          error: null,
                          data: {
                            status: "completed_with_errors",
                            processed_rows: 2000,
                            failed_rows: 1203
                          }
                        })
                    })
                  })
                }),
                update: updateJob
              }
      })
    }));
    const { retryFailedRows } = await import("./imports.service");
    const result = await retryFailedRows(
      { db: membershipDb() as never, orgId: "org-1", actorId: "user-1", correlationId: "corr-1" },
      "job-1"
    );
    expect(result).toEqual({ count: 1200 });
    expect(updateRows).toHaveBeenCalledWith(expect.objectContaining({ status: "pending" }), {
      count: "exact"
    });
    expect(updateJob).toHaveBeenCalledWith({
      status: "ready",
      processed_rows: 800,
      failed_rows: 3,
      finished_at: null
    });
  });
});

function membershipDb() {
  return {
    from: (table: string) => {
      if (table !== "organization_members") throw new Error(`Unexpected context table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { role: "owner" }, error: null })
            })
          })
        })
      };
    }
  };
}
