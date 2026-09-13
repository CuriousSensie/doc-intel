import { afterEach, describe, expect, it, vi } from "vitest";

import type { ServiceContext } from "@/lib/service-context";

afterEach(() => {
  vi.doUnmock("@/lib/events");
  vi.resetModules();
});

function makeChain(result: unknown) {
  const target: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(target, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
          Promise.resolve(result).then(resolve, reject);
      }
      if (prop === "maybeSingle" || prop === "single") {
        return () => Promise.resolve(result);
      }
      return () => proxy;
    }
  });
  return proxy;
}

function makeDb(responses: Record<string, unknown[]>) {
  const counters: Record<string, number> = {};
  return {
    from: (table: string) => {
      const idx = counters[table] ?? 0;
      counters[table] = idx + 1;
      const queued = responses[table];
      return makeChain(queued?.[idx] ?? { data: null, error: null });
    }
  } as unknown as ServiceContext["db"];
}

function makeCtx(db: ServiceContext["db"]): ServiceContext {
  return { db, orgId: "org-1", actorId: "user-1", correlationId: "corr-1" };
}

describe("createConnection", () => {
  it("rejects connecting a record to itself", async () => {
    const db = makeDb({});
    const { createConnection } = await import("@/modules/connections/connections.service");

    await expect(
      createConnection(makeCtx(db), {
        sourceKind: "entity",
        sourceId: "e1",
        targetKind: "entity",
        targetId: "e1"
      })
    ).rejects.toThrow(/itself/);
  });

  it("maps a unique-violation to ConflictError regardless of which side was passed first", async () => {
    vi.doMock("@/lib/events", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));
    const db = makeDb({
      connections: [{ data: null, error: { code: "23505", message: "duplicate key" } }]
    });
    const { createConnection } = await import("@/modules/connections/connections.service");

    await expect(
      createConnection(makeCtx(db), {
        sourceKind: "entity",
        sourceId: "e2",
        targetKind: "entity",
        targetId: "e1"
      })
    ).rejects.toThrow(/already exists/);
  });

  it("defaults relation to related and created_via to manual", async () => {
    const insertedPayloads: unknown[] = [];
    vi.doMock("@/lib/events", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));
    const db = {
      from: (table: string) => {
        if (table !== "connections") return makeChain({ data: null, error: null });
        return {
          insert: (payload: unknown) => {
            insertedPayloads.push(payload);
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: { id: "conn-1", relation: "related", created_via: "manual", rule_id: null },
                    error: null
                  })
              })
            };
          }
        };
      }
    } as unknown as ServiceContext["db"];

    const { createConnection } = await import("@/modules/connections/connections.service");
    await createConnection(makeCtx(db), {
      sourceKind: "document",
      sourceId: "d1",
      targetKind: "entity",
      targetId: "e1"
    });

    expect(insertedPayloads[0]).toMatchObject({ relation: "related", created_via: "manual" });
  });
});

describe("getConnections", () => {
  it("resolves the other side of the connection regardless of which side matches the query", async () => {
    const rows = [
      // this entity (e1) is the source
      {
        id: "conn-1",
        source_kind: "entity",
        source_id: "e1",
        target_kind: "document",
        target_id: "doc-1",
        relation: "related",
        created_via: "manual",
        rule_id: null,
        created_at: "2026-01-01T00:00:00Z"
      },
      // this entity (e1) is the target
      {
        id: "conn-2",
        source_kind: "entity",
        source_id: "e2",
        target_kind: "entity",
        target_id: "e1",
        relation: "part_of",
        created_via: "manual",
        rule_id: null,
        created_at: "2026-01-02T00:00:00Z"
      }
    ];

    const db = makeDb({
      connections: [{ data: rows, error: null }],
      entities: [
        {
          data: [
            {
              id: "e2",
              display_name: "Other Entity",
              entity_type_id: "type-customer",
              deleted_at: null
            }
          ],
          error: null
        }
      ],
      entity_types: [{ data: [{ id: "type-customer", key: "customer", name: "Customer" }], error: null }],
      documents: [{ data: [{ id: "doc-1", title: "Invoice 42", deleted_at: null }], error: null }]
    });

    const { getConnections } = await import("@/modules/connections/connections.service");
    const result = await getConnections(makeCtx(db), "entity", "e1");

    expect(result).toEqual([
      {
        id: "conn-1",
        relation: "related",
        createdVia: "manual",
        ruleId: null,
        createdAt: "2026-01-01T00:00:00Z",
        other: {
          kind: "document",
          id: "doc-1",
          label: "Invoice 42",
          entityTypeKey: null,
          entityTypeName: null,
          isDeleted: false
        }
      },
      {
        id: "conn-2",
        relation: "part_of",
        createdVia: "manual",
        ruleId: null,
        createdAt: "2026-01-02T00:00:00Z",
        other: {
          kind: "entity",
          id: "e2",
          label: "Other Entity",
          entityTypeKey: "customer",
          entityTypeName: "Customer",
          isDeleted: false
        }
      }
    ]);
  });

  it("marks the other side as deleted when it was soft-deleted, keeping its last-known label", async () => {
    const rows = [
      {
        id: "conn-3",
        source_kind: "entity",
        source_id: "e1",
        target_kind: "entity",
        target_id: "e-gone",
        relation: "related",
        created_via: "manual",
        rule_id: null,
        created_at: "2026-01-03T00:00:00Z"
      }
    ];

    const db = makeDb({
      connections: [{ data: rows, error: null }],
      entities: [
        {
          data: [
            {
              id: "e-gone",
              display_name: "Merged Away Ltd",
              entity_type_id: "type-customer",
              deleted_at: "2026-01-04T00:00:00Z"
            }
          ],
          error: null
        }
      ],
      entity_types: [{ data: [{ id: "type-customer", key: "customer", name: "Customer" }], error: null }]
    });

    const { getConnections } = await import("@/modules/connections/connections.service");
    const result = await getConnections(makeCtx(db), "entity", "e1");

    expect(result[0].other).toMatchObject({ label: "Merged Away Ltd", isDeleted: true });
  });
});
