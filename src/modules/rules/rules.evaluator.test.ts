import { describe, expect, it } from "vitest";

import { evaluateConditions } from "./rules.evaluator";
import type { DocumentSubjectContext } from "./rules.context";
import type { ConditionNode } from "./rules.schemas";

function documentSubject(overrides: Partial<DocumentSubjectContext["fields"]> = {}, custom: Record<string, unknown> = {}): DocumentSubjectContext {
  return {
    kind: "document",
    documentId: "doc-1",
    paperlessDocumentId: 1,
    fields: {
      "document.type": "invoice",
      "document.title": "Invoice 42",
      "document.content": "ABC d.o.o. issued this invoice",
      "document.date": "2026-03-01",
      "document.tags": ["auto-filed", "urgent"],
      "document.filename": "Invoice 42",
      "document.source": "upload",
      ...overrides
    },
    custom,
    paperlessAvailable: true,
    customFieldDefs: []
  };
}

describe("evaluateConditions — operators", () => {
  it("eq matches an exact scalar value", () => {
    const node: ConditionNode = { field: "document.type", op: "eq", value: "invoice" };
    expect(evaluateConditions(node, documentSubject()).matched).toBe(true);
    expect(evaluateConditions({ field: "document.type", op: "eq", value: "contract" }, documentSubject()).matched).toBe(false);
  });

  it("eq against an array field checks membership (document.tags)", () => {
    const node: ConditionNode = { field: "document.tags", op: "eq", value: "urgent" };
    expect(evaluateConditions(node, documentSubject()).matched).toBe(true);
  });

  it("neq is the exact inverse of eq", () => {
    const node: ConditionNode = { field: "document.type", op: "neq", value: "invoice" };
    expect(evaluateConditions(node, documentSubject()).matched).toBe(false);
  });

  it("contains / not_contains on a string field", () => {
    expect(evaluateConditions({ field: "document.content", op: "contains", value: "ABC d.o.o." }, documentSubject()).matched).toBe(true);
    expect(evaluateConditions({ field: "document.content", op: "not_contains", value: "XYZ" }, documentSubject()).matched).toBe(true);
  });

  // Real bug found via live testing: a real document's OCR'd content contained "Tintash" and a
  // rule condition written as `contains "tintash"` silently never matched — plain .includes() is
  // case-sensitive. contains/not_contains/starts_with/ends_with must be case-insensitive, since
  // nobody writing a free-text condition expects to guess exact capitalization (matches
  // Paperless's own is_insensitive: true tag matching convention).
  it("contains/starts_with/ends_with are case-insensitive", () => {
    expect(evaluateConditions({ field: "document.content", op: "contains", value: "abc d.o.o." }, documentSubject()).matched).toBe(true);
    expect(evaluateConditions({ field: "document.title", op: "starts_with", value: "invoice" }, documentSubject()).matched).toBe(true);
  });

  it("starts_with / ends_with", () => {
    expect(evaluateConditions({ field: "document.title", op: "starts_with", value: "Invoice" }, documentSubject()).matched).toBe(true);
    expect(evaluateConditions({ field: "document.title", op: "ends_with", value: "42" }, documentSubject()).matched).toBe(true);
  });

  it("regex matches via RE2 and never hangs on a catastrophic pattern", () => {
    expect(evaluateConditions({ field: "document.title", op: "regex", value: "^Invoice \\d+$" }, documentSubject()).matched).toBe(true);

    const pathological = "(a+)+$";
    const subject = documentSubject({ "document.title": "a".repeat(40) + "!" });
    const start = Date.now();
    const result = evaluateConditions({ field: "document.title", op: "regex", value: pathological }, subject);
    expect(Date.now() - start).toBeLessThan(200);
    expect(result.matched).toBe(false);
  });

  it("in / not_in", () => {
    expect(evaluateConditions({ field: "document.type", op: "in", value: ["invoice", "contract"] }, documentSubject()).matched).toBe(true);
    expect(evaluateConditions({ field: "document.type", op: "not_in", value: ["contract", "quotation"] }, documentSubject()).matched).toBe(true);
  });

  it("between is inclusive on both ends", () => {
    const node: ConditionNode = { field: "document.date", op: "between", value: ["2026-01-01", "2026-03-01"] };
    expect(evaluateConditions(node, documentSubject()).matched).toBe(true);
  });

  it("is_empty / is_not_empty", () => {
    const subject = documentSubject({ "document.type": null });
    expect(evaluateConditions({ field: "document.type", op: "is_empty" }, subject).matched).toBe(true);
    expect(evaluateConditions({ field: "document.title", op: "is_not_empty" }, subject).matched).toBe(true);
  });

  it("matches_date compares the exact yyyy-mm-dd string", () => {
    expect(evaluateConditions({ field: "document.date", op: "matches_date", value: "2026-03-01" }, documentSubject()).matched).toBe(true);
    expect(evaluateConditions({ field: "document.date", op: "matches_date", value: "2026-03-02" }, documentSubject()).matched).toBe(false);
  });

  it("reads document.custom.<key>", () => {
    const doc = documentSubject({}, { currency: "EUR" });
    expect(evaluateConditions({ field: "document.custom.currency", op: "eq", value: "EUR" }, doc).matched).toBe(true);
  });
});

describe("evaluateConditions — all/any nesting and trace", () => {
  it("all requires every child to match", () => {
    const node: ConditionNode = {
      all: [
        { field: "document.type", op: "eq", value: "invoice" },
        { field: "document.content", op: "contains", value: "ABC d.o.o." }
      ]
    };
    expect(evaluateConditions(node, documentSubject()).matched).toBe(true);

    const failing: ConditionNode = {
      all: [
        { field: "document.type", op: "eq", value: "invoice" },
        { field: "document.content", op: "contains", value: "XYZ d.o.o." }
      ]
    };
    expect(evaluateConditions(failing, documentSubject()).matched).toBe(false);
  });

  it("any requires at least one child to match", () => {
    const node: ConditionNode = {
      any: [
        { field: "document.content", op: "contains", value: "ABC d.o.o." },
        { field: "document.title", op: "eq", value: "nope" }
      ]
    };
    expect(evaluateConditions(node, documentSubject()).matched).toBe(true);
  });

  it("supports the exact nested DSL shape from specs/07-rules-engine.md", () => {
    const node: ConditionNode = {
      all: [
        { field: "document.type", op: "eq", value: "invoice" },
        {
          any: [
            { field: "document.content", op: "contains", value: "ABC d.o.o." },
            { field: "document.title", op: "eq", value: "nope" }
          ]
        }
      ]
    };
    const result = evaluateConditions(node, documentSubject());
    expect(result.matched).toBe(true);
    expect(result.trace.kind).toBe("all");
  });

  it("the trace reports each leaf's actual value and verdict, not just the final boolean", () => {
    const node: ConditionNode = {
      all: [
        { field: "document.type", op: "eq", value: "invoice" },
        { field: "document.type", op: "eq", value: "contract" }
      ]
    };
    const result = evaluateConditions(node, documentSubject());
    expect(result.matched).toBe(false);
    if (result.trace.kind !== "all") throw new Error("expected all trace");
    expect(result.trace.children).toHaveLength(2);
    expect(result.trace.children[0]).toMatchObject({ kind: "leaf", field: "document.type", actual: "invoice", matched: true });
    expect(result.trace.children[1]).toMatchObject({ kind: "leaf", field: "document.type", actual: "invoice", matched: false });
  });
});
