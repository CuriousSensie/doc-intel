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

const BASE_ENTITY_TYPE = {
  id: "type-1",
  organization_id: "org-1",
  key: "project",
  name: "Project",
  name_plural: "Projects",
  icon: null,
  is_system: true,
  field_schema: [
    { key: "code", label: "Code", type: "string" },
    { key: "budget", label: "Budget", type: "monetary" }
  ],
  created_at: "",
  updated_at: ""
};

describe("createEntityType", () => {
  it("maps a unique-violation to ConflictError", async () => {
    vi.doMock("@/lib/events", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));
    const db = makeDb({
      entity_types: [{ data: null, error: { code: "23505", message: "duplicate key" } }]
    });

    const { createEntityType } = await import("@/modules/entity-types/entity-types.service");

    await expect(
      createEntityType(makeCtx(db), { key: "project", name: "Project", namePlural: "Projects" })
    ).rejects.toThrow(/already exists/);
  });
});

describe("field schema evolution rules (specs/05)", () => {
  it("addField: always allowed, but rejects a duplicate key", async () => {
    vi.doMock("@/lib/events", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));
    const db = makeDb({ entity_types: [{ data: BASE_ENTITY_TYPE, error: null }] });

    const { addField } = await import("@/modules/entity-types/entity-types.service");

    await expect(
      addField(makeCtx(db), "type-1", { key: "code", label: "Code again", type: "string" })
    ).rejects.toThrow(/already exists/);
  });

  it("renameFieldLabel: always allowed for an existing field", async () => {
    const db = makeDb({
      entity_types: [
        { data: BASE_ENTITY_TYPE, error: null }, // fetchEntityType
        { data: { ...BASE_ENTITY_TYPE, field_schema: [] }, error: null } // write result (content not asserted)
      ]
    });

    const { renameFieldLabel } = await import("@/modules/entity-types/entity-types.service");
    await expect(
      renameFieldLabel(makeCtx(db), "type-1", "code", "Project code")
    ).resolves.toBeDefined();
  });

  it("renameFieldLabel: 404s for an unknown field key", async () => {
    const db = makeDb({ entity_types: [{ data: BASE_ENTITY_TYPE, error: null }] });

    const { renameFieldLabel } = await import("@/modules/entity-types/entity-types.service");
    await expect(
      renameFieldLabel(makeCtx(db), "type-1", "does_not_exist", "New label")
    ).rejects.toThrow(/not found/);
  });

  it("changeFieldType: allows the one lossless case (string -> text)", async () => {
    const stringType = {
      ...BASE_ENTITY_TYPE,
      field_schema: [{ key: "notes", label: "Notes", type: "string" }]
    };
    const db = makeDb({
      entity_types: [
        { data: stringType, error: null },
        { data: stringType, error: null }
      ]
    });

    const { changeFieldType } = await import("@/modules/entity-types/entity-types.service");
    await expect(
      changeFieldType(makeCtx(db), "type-1", "notes", "text")
    ).resolves.toBeDefined();
  });

  it("changeFieldType: rejects a non-lossless change", async () => {
    const db = makeDb({ entity_types: [{ data: BASE_ENTITY_TYPE, error: null }] });

    const { changeFieldType } = await import("@/modules/entity-types/entity-types.service");
    await expect(
      changeFieldType(makeCtx(db), "type-1", "code", "integer")
    ).rejects.toThrow(/not a lossless change/);
  });

  it("removeField: soft-hides the field rather than deleting it", async () => {
    let writtenSchema: unknown;
    const db = {
      from: (table: string) => {
        if (table !== "entity_types") return makeChain({ data: null, error: null });
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: BASE_ENTITY_TYPE, error: null }) })
            })
          }),
          update: (payload: { field_schema: unknown }) => {
            writtenSchema = payload.field_schema;
            return {
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    single: () => Promise.resolve({ data: BASE_ENTITY_TYPE, error: null })
                  })
                })
              })
            };
          }
        };
      }
    } as unknown as ServiceContext["db"];

    const { removeField } = await import("@/modules/entity-types/entity-types.service");
    await removeField(makeCtx(db), "type-1", "code");

    expect(writtenSchema).toEqual([
      { key: "code", label: "Code", type: "string", hidden: true },
      { key: "budget", label: "Budget", type: "monetary" }
    ]);
  });
});
