import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/lib/supabase/server");
  vi.resetModules();
});

type Row = { id: string; created_at: string };

function makeQueryBuilder(
  result: { data: Row[] | null; error: unknown },
  onEq?: (column: string, value: unknown) => void
) {
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      onEq?.(column, value);
      return builder;
    },
    order: () => builder,
    limit: () => builder,
    or: () => builder,
    then: (resolve: (value: { data: Row[] | null; error: unknown }) => void) => resolve(result)
  };
  return builder;
}

describe("listAuditLogs", () => {
  it("returns hasMore and a nextCursor when more rows exist than the page size", async () => {
    const items: Row[] = [
      { id: "3", created_at: "2026-01-03T00:00:00.000Z" },
      { id: "2", created_at: "2026-01-02T00:00:00.000Z" },
      { id: "1", created_at: "2026-01-01T00:00:00.000Z" }
    ];

    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ from: () => makeQueryBuilder({ data: items, error: null }) })
    }));

    const { listAuditLogs } = await import("@/modules/admin/audit-log.service");
    const result = await listAuditLogs({ limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).not.toBeNull();
  });

  it("returns no nextCursor when all rows fit on one page", async () => {
    const items: Row[] = [
      { id: "2", created_at: "2026-01-02T00:00:00.000Z" },
      { id: "1", created_at: "2026-01-01T00:00:00.000Z" }
    ];

    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ from: () => makeQueryBuilder({ data: items, error: null }) })
    }));

    const { listAuditLogs } = await import("@/modules/admin/audit-log.service");
    const result = await listAuditLogs();

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });
});

describe("listAuditLogsForSubject", () => {
  it("filters by entity_type and entity_id", async () => {
    const items: Row[] = [{ id: "1", created_at: "2026-01-01T00:00:00.000Z" }];
    const eqCalls: Array<[string, unknown]> = [];

    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        from: () =>
          makeQueryBuilder({ data: items, error: null }, (column, value) =>
            eqCalls.push([column, value])
          )
      })
    }));

    const { listAuditLogsForSubject } = await import("@/modules/admin/audit-log.service");
    const result = await listAuditLogsForSubject("document", "doc-1");

    expect(result.items).toHaveLength(1);
    expect(eqCalls).toEqual([
      ["entity_type", "document"],
      ["entity_id", "doc-1"]
    ]);
  });

  it("propagates a query error", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        from: () => makeQueryBuilder({ data: null, error: new Error("boom") })
      })
    }));

    const { listAuditLogsForSubject } = await import("@/modules/admin/audit-log.service");
    await expect(listAuditLogsForSubject("document", "doc-1")).rejects.toThrow("boom");
  });
});
