import { describe, expect, it } from "vitest";

import type { ServiceContext } from "@/lib/service-context";
import { resolveDocumentRowPlans, resolveEntityRowPlans } from "./imports.matching";
import type { DocumentImportMapping, EntityImportMapping, MetadataOnlyImportMapping } from "./imports.schemas";

// Same Proxy-based mock-DB pattern as connections.service.test.ts/entities.service.test.ts —
// responses queued per table, consumed in call order.
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
      return makeChain(queued?.[idx] ?? { data: [], error: null });
    }
  } as unknown as ServiceContext["db"];
}

function makeCtx(db: ServiceContext["db"]): ServiceContext {
  return { db, orgId: "org-1", actorId: "user-1", correlationId: "corr-1" };
}

const CUSTOMER_ENTITY_TYPE = {
  id: "entity-type-customer",
  organization_id: "org-1",
  key: "customer",
  name: "Customer",
  name_plural: "Customers",
  icon: null,
  is_system: true,
  field_schema: [
    { key: "vat", label: "VAT", type: "string", identifier_kind: "vat" },
    { key: "amount", label: "Amount", type: "monetary", required: false }
  ],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z"
};

describe("resolveEntityRowPlans", () => {
  const mapping: EntityImportMapping = {
    entityTypeKey: "customer",
    displayNameColumn: 1,
    identifierColumns: [{ kind: "vat", column: 0 }],
    fields: [{ column: 2, key: "amount", type: "monetary", decimalSeparator: "," }]
  };

  it("plans a create when no identifier match exists", async () => {
    const db = makeDb({
      entity_types: [{ data: CUSTOMER_ENTITY_TYPE, error: null }],
      entity_identifiers: [{ data: [], error: null }]
    });

    const plans = await resolveEntityRowPlans(makeCtx(db), mapping, [
      { rowNumber: 1, raw: ["SI12345678", "Acme d.o.o.", "1.234,56"] }
    ]);

    expect(plans.get(1)).toEqual({
      action: "create",
      entityTypeId: "entity-type-customer",
      displayName: "Acme d.o.o.",
      // "vat" is the identifier column's own value, written into data (regression: an entity
      // created without it comes out with no entity_identifiers row at all — unfindable on
      // the next reusable-mapping re-import).
      data: { vat: "SI12345678", amount: 1234.56 }
    });
  });

  it("plans an update when the identifier matches an existing entity", async () => {
    const db = makeDb({
      entity_types: [{ data: CUSTOMER_ENTITY_TYPE, error: null }],
      entity_identifiers: [{ data: [{ entity_id: "existing-entity", normalized: "SI12345678" }], error: null }]
    });

    const plans = await resolveEntityRowPlans(makeCtx(db), mapping, [
      { rowNumber: 1, raw: ["SI 12345678", "Acme d.o.o.", "1.234,56"] }
    ]);

    expect(plans.get(1)).toMatchObject({ action: "update", entityId: "existing-entity" });
  });

  it("flags MISSING_REQUIRED when the display name column is empty", async () => {
    const db = makeDb({
      entity_types: [{ data: CUSTOMER_ENTITY_TYPE, error: null }],
      entity_identifiers: [{ data: [], error: null }]
    });

    const plans = await resolveEntityRowPlans(makeCtx(db), mapping, [
      { rowNumber: 1, raw: ["SI12345678", "", "100"] }
    ]);

    expect(plans.get(1)).toMatchObject({ action: "error", code: "MISSING_REQUIRED" });
  });

  it("flags INVALID_NUMBER when a required-equivalent field can't parse (still creates when optional)", async () => {
    const db = makeDb({
      entity_types: [{ data: CUSTOMER_ENTITY_TYPE, error: null }],
      entity_identifiers: [{ data: [], error: null }]
    });

    const plans = await resolveEntityRowPlans(makeCtx(db), mapping, [
      { rowNumber: 1, raw: ["SI12345678", "Acme d.o.o.", "not-a-number"] }
    ]);

    // "amount" isn't required on the field schema, so an unparseable value is dropped, not fatal.
    expect(plans.get(1)).toMatchObject({ action: "create", data: {} });
  });
});

const CUSTOMER_LINK = (overrides: Partial<DocumentImportMapping["entityLinks"][number]> = {}) => ({
  entityTypeKey: "customer",
  matchBy: "identifier" as const,
  identifierKind: "vat",
  column: 1,
  relation: "issued_to" as const,
  onMissing: "skip_connection" as const,
  ...overrides
});

describe("resolveDocumentRowPlans (kind: documents)", () => {
  it("matches an archive file exactly", async () => {
    const mapping: DocumentImportMapping = {
      documentBy: { strategy: "filename", column: 0 },
      entityLinks: [],
      fields: [],
      duplicateStrategy: "skip"
    };
    const db = makeDb({});

    const plans = await resolveDocumentRowPlans(makeCtx(db), "documents", {
      mapping,
      rows: [{ rowNumber: 1, raw: ["invoice-1.pdf"] }],
      archiveEntries: [{ fileName: "invoice-1.pdf", uncompressedSize: 100 }]
    });

    expect(plans.get(1)).toMatchObject({ action: "create_document", archiveFileName: "invoice-1.pdf" });
  });

  it("falls back to a case-insensitive match, then a basename-without-extension match", async () => {
    const mapping: DocumentImportMapping = {
      documentBy: { strategy: "filename", column: 0 },
      entityLinks: [],
      fields: [],
      duplicateStrategy: "skip"
    };
    const db = makeDb({});

    const plans = await resolveDocumentRowPlans(makeCtx(db), "documents", {
      mapping,
      rows: [
        { rowNumber: 1, raw: ["Invoice-1.PDF"] },
        { rowNumber: 2, raw: ["invoice-2"] }
      ],
      archiveEntries: [
        { fileName: "invoice-1.pdf", uncompressedSize: 1 },
        { fileName: "invoice-2.pdf", uncompressedSize: 1 }
      ]
    });

    expect(plans.get(1)).toMatchObject({ archiveFileName: "invoice-1.pdf" });
    expect(plans.get(2)).toMatchObject({ archiveFileName: "invoice-2.pdf" });
  });

  it("flags FILE_MISSING_IN_ARCHIVE when no archive entry matches", async () => {
    const mapping: DocumentImportMapping = {
      documentBy: { strategy: "filename", column: 0 },
      entityLinks: [],
      fields: [],
      duplicateStrategy: "skip"
    };
    const db = makeDb({});

    const plans = await resolveDocumentRowPlans(makeCtx(db), "documents", {
      mapping,
      rows: [{ rowNumber: 1, raw: ["missing.pdf"] }],
      archiveEntries: []
    });

    expect(plans.get(1)).toMatchObject({ action: "error", code: "FILE_MISSING_IN_ARCHIVE" });
  });

  it("skips a checksum duplicate but still resolves entity links (specs/06's second clause)", async () => {
    const mapping: DocumentImportMapping = {
      documentBy: { strategy: "checksum", column: 0 },
      entityLinks: [CUSTOMER_LINK()],
      fields: [],
      duplicateStrategy: "skip"
    };
    const db = makeDb({
      documents: [{ data: [{ id: "existing-doc", checksum: "abc123" }], error: null }],
      entity_identifiers: [{ data: [{ entity_id: "cust-1", normalized: "SI12345678" }], error: null }]
    });

    const plans = await resolveDocumentRowPlans(makeCtx(db), "documents", {
      mapping,
      rows: [{ rowNumber: 1, raw: ["abc123", "SI12345678"] }]
    });

    expect(plans.get(1)).toMatchObject({
      action: "skip_duplicate",
      documentId: "existing-doc",
      entityLinks: [{ outcome: "linked", entityId: "cust-1", relation: "issued_to" }]
    });
  });

  it("fails the row on a checksum duplicate when duplicateStrategy is fail", async () => {
    const mapping: DocumentImportMapping = {
      documentBy: { strategy: "checksum", column: 0 },
      entityLinks: [],
      fields: [],
      duplicateStrategy: "fail"
    };
    const db = makeDb({
      documents: [{ data: [{ id: "existing-doc", checksum: "abc123" }], error: null }]
    });

    const plans = await resolveDocumentRowPlans(makeCtx(db), "documents", {
      mapping,
      rows: [{ rowNumber: 1, raw: ["abc123"] }]
    });

    expect(plans.get(1)).toMatchObject({ action: "error", code: "DUPLICATE" });
  });

  it("resolves entity links per on_missing: create / skip_connection / fail_row", async () => {
    const mapping: DocumentImportMapping = {
      documentBy: { strategy: "filename", column: 0 },
      entityLinks: [
        CUSTOMER_LINK({ column: 1, onMissing: "create" }),
        CUSTOMER_LINK({ column: 2, onMissing: "skip_connection" }),
        CUSTOMER_LINK({ column: 3, onMissing: "fail_row" })
      ],
      fields: [],
      duplicateStrategy: "skip"
    };
    const db = makeDb({ entity_identifiers: [{ data: [], error: null }] });

    const plans = await resolveDocumentRowPlans(makeCtx(db), "documents", {
      mapping,
      rows: [{ rowNumber: 1, raw: ["invoice.pdf", "SI111", "SI222", "SI333"] }],
      archiveEntries: [{ fileName: "invoice.pdf", uncompressedSize: 1 }]
    });

    const plan = plans.get(1) as { entityLinks: Array<{ outcome: string }> };
    expect(plan.entityLinks.map((l) => l.outcome)).toEqual(["create", "skipped", "fail_row"]);
  });

  it("carries the identifier kind+value through a create outcome (regression: entities auto-created via a link came out with no identifier)", async () => {
    const mapping: DocumentImportMapping = {
      documentBy: { strategy: "filename", column: 0 },
      entityLinks: [CUSTOMER_LINK({ column: 1, onMissing: "create" })],
      fields: [],
      duplicateStrategy: "skip"
    };
    const db = makeDb({ entity_identifiers: [{ data: [], error: null }] });

    const plans = await resolveDocumentRowPlans(makeCtx(db), "documents", {
      mapping,
      rows: [{ rowNumber: 1, raw: ["invoice.pdf", "SI111"] }],
      archiveEntries: [{ fileName: "invoice.pdf", uncompressedSize: 1 }]
    });

    const plan = plans.get(1) as { entityLinks: Array<Record<string, unknown>> };
    expect(plan.entityLinks[0]).toMatchObject({
      outcome: "create",
      identifierKind: "vat",
      identifierValue: "SI111"
    });
  });
});

describe("resolveDocumentRowPlans (kind: metadata_only)", () => {
  it("connects to an existing document matched by checksum", async () => {
    const mapping: MetadataOnlyImportMapping = {
      documentBy: { strategy: "checksum", column: 0 },
      entityLinks: [],
      fields: []
    };
    const db = makeDb({
      documents: [{ data: [{ id: "doc-1", checksum: "abc123", paperless_document_id: 42 }], error: null }]
    });

    const plans = await resolveDocumentRowPlans(makeCtx(db), "metadata_only", {
      mapping,
      rows: [{ rowNumber: 1, raw: ["abc123"] }]
    });

    expect(plans.get(1)).toMatchObject({
      action: "connect_existing",
      documentId: "doc-1",
      paperlessDocumentId: 42
    });
  });

  it("flags DOCUMENT_NOT_FOUND when nothing matches", async () => {
    const mapping: MetadataOnlyImportMapping = {
      documentBy: { strategy: "checksum", column: 0 },
      entityLinks: [],
      fields: []
    };
    const db = makeDb({ documents: [{ data: [], error: null }] });

    const plans = await resolveDocumentRowPlans(makeCtx(db), "metadata_only", {
      mapping,
      rows: [{ rowNumber: 1, raw: ["nope"] }]
    });

    expect(plans.get(1)).toMatchObject({ action: "error", code: "DOCUMENT_NOT_FOUND" });
  });
});
