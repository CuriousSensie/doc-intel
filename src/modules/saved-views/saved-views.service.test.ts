import { describe, expect, it } from "vitest";

import type { ServiceContext } from "@/lib/service-context";
import { createSavedViewSchema } from "@/modules/saved-views/saved-views.schemas";
import { createSavedView, ensureStarterViews } from "@/modules/saved-views/saved-views.service";

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

describe("ensureStarterViews", () => {
  it("does nothing when the org already has saved views", async () => {
    const db = makeDb({
      saved_views: [{ data: [{ id: "view-1", name: "Existing" }], error: null }]
    });

    const result = await ensureStarterViews(makeCtx(db));
    expect(result).toEqual([{ id: "view-1", name: "Existing" }]);
  });

  it("seeds the five starter views when the org has none", async () => {
    const inserted: unknown[] = [];
    const db = {
      from: (table: string) => {
        if (table !== "saved_views") return makeChain({ data: [], error: null });
        return {
          select: () => ({
            eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) })
          }),
          insert: (rows: unknown[]) => {
            inserted.push(...rows);
            return { select: () => Promise.resolve({ data: rows, error: null }) };
          }
        };
      }
    } as unknown as ServiceContext["db"];

    const result = await ensureStarterViews(makeCtx(db));
    expect(result).toHaveLength(5);
    expect(inserted.map((v) => (v as { name: string }).name)).toEqual([
      "All documents",
      "Documents with no connections",
      "Invoices this year",
      "Open contracts",
      "Recently added"
    ]);
  });
});

describe("createSavedViewSchema", () => {
  it("defaults dynamic views to personal with no fixed documents", () => {
    const result = createSavedViewSchema.parse({
      name: "Invoices",
      scope: "documents",
      filters: { documentTypeKey: "invoice" }
    });

    expect(result.viewKind).toBe("dynamic");
    expect(result.isShared).toBe(false);
    expect(result.documentIds).toEqual([]);
  });

  it("requires fixed document ids for static document views", () => {
    expect(
      createSavedViewSchema.safeParse({
        name: "Picked documents",
        scope: "documents",
        viewKind: "static",
        documentIds: []
      }).success
    ).toBe(false);

    expect(
      createSavedViewSchema.safeParse({
        name: "Picked documents",
        scope: "documents",
        viewKind: "static",
        documentIds: ["00000000-0000-4000-8000-000000000001"]
      }).success
    ).toBe(true);
  });
});

describe("createSavedView", () => {
  it("persists static document views with document ids", async () => {
    let inserted: Record<string, unknown> | null = null;
    const db = {
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          inserted = row;
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: "view-1", ...row }, error: null })
            })
          };
        }
      })
    } as unknown as ServiceContext["db"];

    await createSavedView(makeCtx(db), {
      name: "Selection",
      scope: "documents",
      viewKind: "static",
      documentIds: ["00000000-0000-4000-8000-000000000001"]
    });

    expect(inserted).toMatchObject({
      view_kind: "static",
      document_ids: ["00000000-0000-4000-8000-000000000001"],
      is_shared: false
    });
  });
});
