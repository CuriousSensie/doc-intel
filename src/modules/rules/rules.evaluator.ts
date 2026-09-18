import { safeRegexTest } from "@/lib/safe-regex";
import type { SubjectContext } from "./rules.context";
import type { ConditionLeaf, ConditionNode } from "./rules.schemas";

export type ConditionTrace =
  | { kind: "leaf"; field: string; op: string; expected: unknown; actual: unknown; matched: boolean }
  | { kind: "all"; matched: boolean; children: ConditionTrace[] }
  | { kind: "any"; matched: boolean; children: ConditionTrace[] };

export type EvaluationResult = { matched: boolean; trace: ConditionTrace };

// specs/07-rules-engine.md §Condition fields: document.custom.<key> / entity.data.<key> are the
// only field paths not covered by the subject's fixed `fields` map.
function resolveFieldValue(subject: SubjectContext, field: string): unknown {
  if (field.startsWith("document.custom.")) {
    return subject.kind === "document" ? subject.custom[field.slice("document.custom.".length)] : undefined;
  }
  if (field.startsWith("entity.data.")) {
    return subject.kind === "entity" ? subject.data[field.slice("entity.data.".length)] : undefined;
  }
  return (subject.fields as Record<string, unknown>)[field];
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function toComparable(value: unknown): number | string | null {
  if (typeof value === "number" || typeof value === "string") return value;
  if (value instanceof Date) return value.getTime();
  if (value === null || value === undefined) return null;
  return String(value);
}

// One leaf evaluation, one verdict. `regex` is the only operator with a real DoS surface
// (specs/07: "100ms hard timeout... use RE2-style safe matching") — routed through
// safeRegexTest() (RE2, linear-time by construction) rather than the native RegExp engine.
function evaluateOperator(op: ConditionLeaf["op"], actual: unknown, expected: unknown): boolean {
  switch (op) {
    case "eq":
      return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
    case "neq":
      return !(Array.isArray(actual) ? actual.includes(expected) : actual === expected);
    // Real bug found via live testing: a document whose real OCR'd content contained "Tintash"
    // never matched a rule condition written as `contains "tintash"` — plain .includes() is
    // case-sensitive, and nobody writing a free-text content/filename condition expects to have
    // to guess exact capitalization. Paperless's own tag/correspondent matching is always
    // is_insensitive: true (attributes.service.ts) — text-comparison operators here match that
    // convention. eq/neq/in/not_in stay exact, since those compare precise identifiers (a tag
    // name, a document type), not free text.
    case "contains":
      if (Array.isArray(actual)) return actual.includes(expected);
      return (
        typeof actual === "string" &&
        typeof expected === "string" &&
        actual.toLocaleLowerCase().includes(expected.toLocaleLowerCase())
      );
    case "not_contains":
      if (Array.isArray(actual)) return !actual.includes(expected);
      return !(
        typeof actual === "string" &&
        typeof expected === "string" &&
        actual.toLocaleLowerCase().includes(expected.toLocaleLowerCase())
      );
    case "starts_with":
      return (
        typeof actual === "string" &&
        typeof expected === "string" &&
        actual.toLocaleLowerCase().startsWith(expected.toLocaleLowerCase())
      );
    case "ends_with":
      return (
        typeof actual === "string" &&
        typeof expected === "string" &&
        actual.toLocaleLowerCase().endsWith(expected.toLocaleLowerCase())
      );
    case "regex":
      return typeof actual === "string" && typeof expected === "string" && safeRegexTest(expected, actual);
    case "in":
      return Array.isArray(expected) && expected.includes(actual as never);
    case "not_in":
      return Array.isArray(expected) && !expected.includes(actual as never);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = toComparable(actual);
      const e = toComparable(expected);
      if (a === null || e === null) return false;
      if (op === "gt") return a > e;
      if (op === "gte") return a >= e;
      if (op === "lt") return a < e;
      return a <= e;
    }
    case "between": {
      if (!Array.isArray(expected) || expected.length !== 2) return false;
      const a = toComparable(actual);
      const lo = toComparable(expected[0]);
      const hi = toComparable(expected[1]);
      if (a === null || lo === null || hi === null) return false;
      return a >= lo && a <= hi;
    }
    case "is_empty":
      return isEmpty(actual);
    case "is_not_empty":
      return !isEmpty(actual);
    case "matches_date":
      // dd.mm.yyyy locale display aside, condition values are always stored/compared as
      // yyyy-mm-dd (specs/02-data-model.md) — a plain string-equality check is exact and
      // avoids reimplementing date parsing here.
      return typeof actual === "string" && actual === expected;
    default:
      return false;
  }
}

function evaluateLeaf(leaf: ConditionLeaf, subject: SubjectContext): ConditionTrace {
  const actual = resolveFieldValue(subject, leaf.field);
  const matched = evaluateOperator(leaf.op, actual, leaf.value);
  return { kind: "leaf", field: leaf.field, op: leaf.op, expected: leaf.value ?? null, actual: actual ?? null, matched };
}

export function evaluateConditions(node: ConditionNode, subject: SubjectContext): EvaluationResult {
  if ("all" in node) {
    const children = node.all.map((child) => evaluateConditions(child, subject));
    const matched = children.every((c) => c.matched);
    return { matched, trace: { kind: "all", matched, children: children.map((c) => c.trace) } };
  }
  if ("any" in node) {
    const children = node.any.map((child) => evaluateConditions(child, subject));
    const matched = children.some((c) => c.matched);
    return { matched, trace: { kind: "any", matched, children: children.map((c) => c.trace) } };
  }
  const trace = evaluateLeaf(node, subject);
  return { matched: trace.matched, trace };
}
