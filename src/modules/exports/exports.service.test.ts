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
    expect(result).toEqual({ rows: [], entityTypeColumns: [] });
  });

  it("resolves a connected-entity column per entity type, joining multiple entities of the same type", async () => {
    const documents = [
      {
        id: "doc-1",
        title: "Invoice 1",
        document_type_key: "invoice",
        document_date: "2026-03-05",
        correspondent_name: "Acme",
        status: "ready"
      }
    ];
    const asSource = [{ source_id: "doc-1", target_kind: "entity", target_id: "e1" }];
    const asTarget = [{ target_id: "doc-1", source_kind: "entity", source_id: "e2" }];
    const entities = [
      { id: "e1", display_name: "Customer A", entity_type_id: "t-customer", deleted_at: null },
      { id: "e2", display_name: "Customer B", entity_type_id: "t-customer", deleted_at: null }
    ];
    const entityTypes = [{ id: "t-customer", key: "customer", name: "Stranka" }];

    const responses: Record<string, unknown> = {
      documents: { data: documents, error: null },
      connections: null, // handled positionally below
      entities: { data: entities, error: null },
      entity_types: { data: entityTypes, error: null }
    };
    let connectionsCallIndex = 0;
    const connectionsResponses = [
      { data: asSource, error: null },
      { data: asTarget, error: null }
    ];

    const db = {
      from: (table: string) => {
        if (table === "connections") {
          const response = connectionsResponses[connectionsCallIndex];
          connectionsCallIndex += 1;
          return makeChain(response);
        }
        return makeChain(responses[table]);
      }
    } as unknown as ServiceContext["db"];

    const result = await resolveExportData(makeCtx(db), ["doc-1"]);

    expect(result.entityTypeColumns).toEqual([{ key: "customer", label: "Stranka" }]);
    expect(result.rows).toEqual([
      {
        documentId: "doc-1",
        title: "Invoice 1",
        documentTypeKey: "invoice",
        documentDate: "2026-03-05",
        correspondentName: "Acme",
        status: "ready",
        entityColumns: { customer: "Customer A; Customer B" }
      }
    ]);
  });

  it("skips soft-deleted connected entities", async () => {
    const documents = [
      {
        id: "doc-1",
        title: "Invoice 1",
        document_type_key: null,
        document_date: null,
        correspondent_name: null,
        status: "ready"
      }
    ];
    const asSource = [{ source_id: "doc-1", target_kind: "entity", target_id: "e-gone" }];
    const entities = [
      { id: "e-gone", display_name: "Gone Ltd", entity_type_id: "t-customer", deleted_at: "2026-01-01" }
    ];
    const entityTypes = [{ id: "t-customer", key: "customer", name: "Stranka" }];

    let connectionsCallIndex = 0;
    const connectionsResponses = [
      { data: asSource, error: null },
      { data: [], error: null }
    ];

    const db = {
      from: (table: string) => {
        if (table === "connections") {
          const response = connectionsResponses[connectionsCallIndex];
          connectionsCallIndex += 1;
          return makeChain(response);
        }
        if (table === "documents") return makeChain({ data: documents, error: null });
        if (table === "entities") return makeChain({ data: entities, error: null });
        if (table === "entity_types") return makeChain({ data: entityTypes, error: null });
        return makeChain({ data: null, error: null });
      }
    } as unknown as ServiceContext["db"];

    const result = await resolveExportData(makeCtx(db), ["doc-1"]);

    expect(result.entityTypeColumns).toEqual([]);
    expect(result.rows[0].entityColumns).toEqual({});
  });
});
