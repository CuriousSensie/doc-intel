import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/lib/supabase/server");
  vi.resetModules();
});

type Row = { id: string; created_at: string };

function makeQueryBuilder(result: { data: Row[] | null; error: unknown }) {
  const builder = {
    select: () => builder,
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
