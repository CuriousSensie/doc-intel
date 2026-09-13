import { afterEach, describe, expect, it, vi } from "vitest";

import type { ServiceContext } from "@/lib/service-context";

afterEach(() => {
  vi.doUnmock("@/lib/events");
  vi.doUnmock("@/modules/entity-types/entity-types.service");
  vi.resetModules();
});

// A single fake that's both chainable (every method returns itself) and thenable (awaiting it
// at any point in the chain resolves to the configured result) — matches how differently each
// call site in entities.service.ts terminates its query (.maybeSingle(), .single(), or a bare
// await after the last .eq()/.or()).
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
      const result = queued?.[idx] ?? { data: null, error: null };
      return makeChain(result);
    }
  } as unknown as ServiceContext["db"];
}

function makeCtx(db: ServiceContext["db"]): ServiceContext {
  return { db, orgId: "org-1", actorId: "user-1", correlationId: "corr-1" };
}

const CUSTOMER_ENTITY_TYPE = {
  id: "type-1",
  organization_id: "org-1",
  key: "customer",
  name: "Customer",
  name_plural: "Customers",
  icon: null,
  is_system: true,
  field_schema: [{ key: "vat", label: "VAT", type: "string", identifier_kind: "vat" }],
  created_at: "",
  updated_at: ""
};

function mockEntityType(fieldSchema: unknown[] = CUSTOMER_ENTITY_TYPE.field_schema) {
  vi.doMock("@/modules/entity-types/entity-types.service", () => ({
    getEntityType: vi.fn().mockResolvedValue({ ...CUSTOMER_ENTITY_TYPE, field_schema: fieldSchema }),
    getVisibleFieldSchema: vi.fn().mockReturnValue(fieldSchema)
  }));
}

describe("createEntity", () => {
  it("creates an entity with no identifier fields and logs the event", async () => {
    mockEntityType([]);
    const logEvent = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/events", () => ({ logEvent }));

    const db = makeDb({
      entities: [{ data: { id: "entity-1", display_name: "Acme" }, error: null }]
    });

    const { createEntity } = await import("@/modules/entities/entities.service");
    const result = await createEntity(makeCtx(db), {
      entityTypeId: "type-1",
      displayName: "Acme",
      data: {}
    });

    expect(result).toEqual({ id: "entity-1", display_name: "Acme" });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "entity.created", entityId: "entity-1" })
    );
  });

  it("throws ConflictError when the auto-promoted identifier collides with another entity", async () => {
    mockEntityType();
    vi.doMock("@/lib/events", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));

    const db = makeDb({
      entities: [{ data: { id: "entity-1", display_name: "Acme" }, error: null }],
      entity_identifiers: [
        { data: [], error: null }, // existing identifiers lookup — none yet
        { data: null, error: { code: "23505", message: "duplicate key" } } // insert collides
      ]
    });

    const { createEntity } = await import("@/modules/entities/entities.service");

    await expect(
      createEntity(makeCtx(db), {
        entityTypeId: "type-1",
        displayName: "Acme",
        data: { vat: "SI12345678" }
      })
    ).rejects.toThrow(/already used by another entity/);
  });
});

describe("deleteEntity", () => {
  it("refuses to delete when connections exist and force is not set", async () => {
    vi.doMock("@/lib/events", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));

    const db = makeDb({
      entities: [{ data: { id: "entity-1", organization_id: "org-1" }, error: null }],
      connections: [{ count: 2, error: null }]
    });

    const { deleteEntity } = await import("@/modules/entities/entities.service");

    await expect(deleteEntity(makeCtx(db), "entity-1")).rejects.toThrow(/has connections/);
  });

  it("deletes when forced, without checking connections", async () => {
    const logEvent = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/events", () => ({ logEvent }));

    const db = makeDb({
      entities: [
        { data: { id: "entity-1", organization_id: "org-1" }, error: null }, // fetchEntity
        { data: null, error: null } // update
      ]
    });

    const { deleteEntity } = await import("@/modules/entities/entities.service");
    await deleteEntity(makeCtx(db), "entity-1", { force: true });

    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "entity.deleted", metadata: { forced: true } })
    );
  });
});
