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

describe("createCustomFieldDef — decision-rule enforcement (specs/02, rule 6)", () => {
  it("rejects a documentlink field backed by a Paperless custom field id", async () => {
    const db = makeDb({});
    const { createCustomFieldDef } = await import(
      "@/modules/custom-fields/custom-field-defs.service"
    );

    await expect(
      createCustomFieldDef(makeCtx(db), {
        key: "linked_customer",
        label: "Linked customer",
        dataType: "documentlink",
        paperlessCustomFieldId: 42
      })
    ).rejects.toThrow(/never be.*backed by a Paperless custom field/);
  });

  it("allows a documentlink field with no Paperless backing (Pomočnik-only)", async () => {
    vi.doMock("@/lib/events", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));
    const db = makeDb({
      custom_field_defs: [{ data: { id: "cfd-1", key: "linked_customer" }, error: null }]
    });
    const { createCustomFieldDef } = await import(
      "@/modules/custom-fields/custom-field-defs.service"
    );

    await expect(
      createCustomFieldDef(makeCtx(db), {
        key: "linked_customer",
        label: "Linked customer",
        dataType: "documentlink"
      })
    ).resolves.toMatchObject({ id: "cfd-1" });
  });

  it("allows a normal scalar field backed by a real Paperless custom field", async () => {
    vi.doMock("@/lib/events", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));
    const db = makeDb({
      custom_field_defs: [{ data: { id: "cfd-2", key: "invoice_no" }, error: null }]
    });
    const { createCustomFieldDef } = await import(
      "@/modules/custom-fields/custom-field-defs.service"
    );

    await expect(
      createCustomFieldDef(makeCtx(db), {
        key: "invoice_no",
        label: "Invoice number",
        dataType: "string",
        paperlessCustomFieldId: 7
      })
    ).resolves.toMatchObject({ id: "cfd-2" });
  });

  it("maps a unique-violation on key to ConflictError", async () => {
    const db = makeDb({
      custom_field_defs: [{ data: null, error: { code: "23505", message: "duplicate key" } }]
    });
    const { createCustomFieldDef } = await import(
      "@/modules/custom-fields/custom-field-defs.service"
    );

    await expect(
      createCustomFieldDef(makeCtx(db), {
        key: "invoice_no",
        label: "Invoice number",
        dataType: "string"
      })
    ).rejects.toThrow(/already exists/);
  });
});
