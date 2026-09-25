import { describe, expect, it } from "vitest";

import type { ServiceContext } from "@/lib/service-context";
import { resolveExportData } from "./exports.service";

function makeCtx(db: ServiceContext["db"]): ServiceContext {
  return { db, orgId: "org-1", actorId: "user-1", correlationId: "corr-1" };
}

function makeChain(result: unknown) {
  const target: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(target, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve);
      }
      return () => proxy;
    }
  });
  return proxy;
}

describe("resolveExportData", () => {
  it("returns no rows and no columns for an empty document id list without querying", async () => {
    const db = { from: () => makeChain({ data: null, error: null }) } as unknown as ServiceContext["db"];
    const result = await resolveExportData(makeCtx(db), []);
    expect(result).toEqual({ rows: [] });
  });
});
