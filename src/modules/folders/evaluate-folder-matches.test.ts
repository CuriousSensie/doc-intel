import { describe, expect, it, vi } from "vitest";

import type { ServiceContext } from "@/lib/service-context";
import type { DocumentSubjectContext } from "@/modules/rules/rules.context";

function makeSubject(overrides: Partial<DocumentSubjectContext["fields"]> = {}): DocumentSubjectContext {
  return {
    kind: "document",
    documentId: "doc-1",
    paperlessDocumentId: 1,
    fields: {
      "document.type": null,
      "document.title": "Invoice 123",
      "document.content": "Invoice content",
      "document.correspondent": null,
      "document.date": null,
      "document.tags": [],
      "document.filename": "invoice-123.pdf",
      "document.source": "upload",
      "connection.count": 0,
      ...overrides
    },
    custom: {},
    paperlessAvailable: true,
    customFieldDefs: []
  };
}

function makeTable(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: rows, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockResolvedValue({ error: null })
  };
}

describe("evaluateFolderMatchesForDocument", () => {
  it("does nothing when no folder has a match pattern", async () => {
    const foldersTable = makeTable([]);
    const from = vi.fn((table: string) => (table === "folders" ? foldersTable : makeTable([])));
    const ctx = { db: { from }, orgId: "org-1", actorId: null, correlationId: "c1" } as unknown as ServiceContext;
    const { evaluateFolderMatchesForDocument } = await import("./folders.service");

    await evaluateFolderMatchesForDocument(ctx, "doc-1", makeSubject());

    expect(foldersTable.update).not.toHaveBeenCalled();
  });

  it("skips auto-filing when a user already filed the document manually", async () => {
    const foldersTable = makeTable([
      { id: "folder-1", match_conditions: { field: "document.filename", op: "contains", value: "invoice" } }
    ]);
    const provenanceTable = makeTable([]);
    provenanceTable.maybeSingle = vi.fn().mockResolvedValue({ data: { field_key: "document.folder_id" }, error: null });
    const from = vi.fn((table: string) => {
      if (table === "folders") return foldersTable;
      if (table === "field_provenance") return provenanceTable;
      return makeTable([]);
    });
    const ctx = { db: { from }, orgId: "org-1", actorId: null, correlationId: "c1" } as unknown as ServiceContext;
    const { evaluateFolderMatchesForDocument } = await import("./folders.service");

    await evaluateFolderMatchesForDocument(ctx, "doc-1", makeSubject());

    expect(foldersTable.update).not.toHaveBeenCalled();
  });

  it("files into the deepest matching folder and records provenance", async () => {
    const foldersTable = makeTable([
      { id: "folder-deep", match_conditions: { field: "document.filename", op: "contains", value: "invoice" } },
      { id: "folder-shallow", match_conditions: { field: "document.filename", op: "contains", value: "invoice" } }
    ]);
    const documentsTable = makeTable([]);
    const provenanceTable = makeTable([]);
    const from = vi.fn((table: string) => {
      if (table === "folders") return foldersTable;
      if (table === "documents") return documentsTable;
      if (table === "field_provenance") return provenanceTable;
      return makeTable([]);
    });
    const ctx = { db: { from }, orgId: "org-1", actorId: null, correlationId: "c1" } as unknown as ServiceContext;
    const { evaluateFolderMatchesForDocument } = await import("./folders.service");

    await evaluateFolderMatchesForDocument(ctx, "doc-1", makeSubject());

    // order("depth", {ascending:false}) is mocked to just return the rows as given — this test
    // asserts the *first* row returned by that ordering wins (first-match-wins on an
    // already-depth-sorted list), not that this test itself re-sorts by depth.
    expect(documentsTable.update).toHaveBeenCalledWith({ folder_id: "folder-deep" });
    expect(provenanceTable.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ field_key: "document.folder_id", updated_by: "system", source_id: "folder-deep" }),
      { onConflict: "document_id,field_key" }
    );
  });
});
