"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateFolderMatchConditionsAction } from "@/modules/folders/folders.actions";
import { CONDITION_OPERATORS, type ConditionNode, type ConditionOperator } from "@/modules/rules/rules.schemas";
import type { Folder } from "@/modules/folders/folders.service";

// ADR-0019: a folder's match_conditions reuses the rules engine's ConditionNode verbatim, but the
// brief scopes the folder-authoring UI to the document-level fields only (no entity.type /
// connection.count — those don't make sense against "which folder does this land in"). No
// reusable condition-tree component exists yet in src/components/rules (rule-form.tsx builds its
// own guided subset inline, not as an exported component), so this is a second, minimal builder
// over the same DSL rather than a from-scratch DSL.
const MATCH_FIELDS = [
  "document.type",
  "document.title",
  "document.content",
  "document.correspondent",
  "document.date",
  "document.tags",
  "document.filename",
  "document.source"
] as const;
type MatchField = (typeof MATCH_FIELDS)[number];

// next-intl splits a t() key on "." for nested-message lookup (same gotcha rules.schemas.ts's
// TRIGGER_MESSAGE_KEYS documents), so a field value like "document.type" can never be used
// directly as part of a key — messages/*/folders.json's `match.field` keys are the underscore
// form specifically so this map is the only place that has to know it.
const FIELD_MESSAGE_KEYS = {
  "document.type": "document_type",
  "document.title": "document_title",
  "document.content": "document_content",
  "document.correspondent": "document_correspondent",
  "document.date": "document_date",
  "document.tags": "document_tags",
  "document.filename": "document_filename",
  "document.source": "document_source"
} as const satisfies Record<MatchField, string>;

const OPS_NEEDING_NO_VALUE: ConditionOperator[] = ["is_empty", "is_not_empty"];
const OPS_NEEDING_LIST: ConditionOperator[] = ["in", "not_in", "between"];

type Row = { key: string; field: MatchField; op: ConditionOperator; value: string };

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `match-${keySeq}`;
}

function newRow(): Row {
  return { key: nextKey(), field: "document.filename", op: "contains", value: "" };
}

function isMatchField(value: string): value is MatchField {
  return (MATCH_FIELDS as readonly string[]).includes(value);
}

// Hydrates an existing folder's matchConditions into editable rows. Only a flat {all:[...]} or
// {any:[...]} of leaves round-trips through this editor — a deeper/nested tree (not producible by
// this UI, but possible if authored elsewhere) falls back to "unsupported", surfaced to the user
// rather than silently discarded.
function hydrate(node: ConditionNode | null): { rows: Row[]; mode: "all" | "any" } | "unsupported" {
  if (!node) return { rows: [], mode: "all" };
  const isLeaf = (n: ConditionNode): n is Extract<ConditionNode, { field: string }> => "field" in n;
  if (isLeaf(node)) {
    if (!isMatchField(node.field)) return "unsupported";
    return {
      mode: "all",
      rows: [
        {
          key: nextKey(),
          field: node.field,
          op: node.op as ConditionOperator,
          value: Array.isArray(node.value) ? node.value.join(",") : String(node.value ?? "")
        }
      ]
    };
  }
  const mode: "all" | "any" = "all" in node ? "all" : "any";
  const children = "all" in node ? node.all : "any" in node ? node.any : [];
  if (!children.every((c) => isLeaf(c))) return "unsupported";
  const rows = (children as Array<{ field: string; op: string; value?: unknown }>).map((leaf) => {
    if (!isMatchField(leaf.field)) return null;
    return {
      key: nextKey(),
      field: leaf.field,
      op: leaf.op as ConditionOperator,
      value: Array.isArray(leaf.value) ? leaf.value.join(",") : String(leaf.value ?? "")
    };
  });
  if (rows.some((r) => r === null)) return "unsupported";
  return { mode, rows: rows as Row[] };
}

function serialize(rows: Row[], mode: "all" | "any"): ConditionNode | null {
  if (rows.length === 0) return null;
  const leaves = rows.map((row) => {
    const needsValue = !OPS_NEEDING_NO_VALUE.includes(row.op);
    const value = OPS_NEEDING_LIST.includes(row.op)
      ? row.value.split(",").map((v) => v.trim()).filter(Boolean)
      : row.value;
    return needsValue ? { field: row.field, op: row.op, value } : { field: row.field, op: row.op };
  });
  return leaves.length === 1 ? leaves[0] : ({ [mode]: leaves } as ConditionNode);
}

export function FolderMatchEditor({ folder }: { folder: Folder }) {
  const t = useTranslations("folders.match");
  const hydrated = hydrate(folder.matchConditions);
  const [unsupported] = useState(hydrated === "unsupported");
  const [rows, setRows] = useState<Row[]>(hydrated === "unsupported" ? [] : hydrated.rows);
  const [mode, setMode] = useState<"all" | "any">(hydrated === "unsupported" ? "all" : hydrated.mode);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await updateFolderMatchConditionsAction({
          folderId: folder.id,
          matchConditions: serialize(rows, mode)
        });
        toast.success(t("saved"));
      } catch (err) {
        setError(err instanceof Error ? err.message : t("saveFailed"));
      }
    });
  }

  function clear() {
    setRows([]);
    setError(null);
    startTransition(async () => {
      try {
        await updateFolderMatchConditionsAction({ folderId: folder.id, matchConditions: null });
        toast.success(t("cleared"));
      } catch (err) {
        setError(err instanceof Error ? err.message : t("saveFailed"));
      }
    });
  }

  return (
    <div className="grid gap-3">
      {unsupported ? <p className="text-sm text-danger">{t("unsupportedExisting")}</p> : null}
      <p className="text-sm text-muted">{t("description")}</p>

      {rows.length > 1 ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted">{t("matchLabel")}</span>
          <div className="flex overflow-hidden rounded-md border border-border">
            {(["all", "any"] as const).map((m) => (
              <button
                aria-pressed={mode === m}
                className="px-3 py-1 data-[active=true]:bg-panel-strong data-[active=true]:font-semibold"
                data-active={mode === m}
                key={m}
                onClick={() => setMode(m)}
                type="button"
              >
                {t(`mode.${m}`)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-2">
        {rows.map((row) => (
          <div className="flex flex-wrap items-center gap-2" key={row.key}>
            <select
              className="min-h-9 rounded-md border border-border bg-panel px-2 text-sm"
              onChange={(e) =>
                setRows((prev) =>
                  prev.map((r) => (r.key === row.key ? { ...r, field: e.target.value as MatchField } : r))
                )
              }
              value={row.field}
            >
              {MATCH_FIELDS.map((field) => (
                <option key={field} value={field}>
                  {t(`field.${FIELD_MESSAGE_KEYS[field]}`)}
                </option>
              ))}
            </select>
            <select
              className="min-h-9 rounded-md border border-border bg-panel px-2 text-sm"
              onChange={(e) =>
                setRows((prev) =>
                  prev.map((r) =>
                    r.key === row.key ? { ...r, op: e.target.value as ConditionOperator } : r
                  )
                )
              }
              value={row.op}
            >
              {CONDITION_OPERATORS.map((op) => (
                <option key={op} value={op}>
                  {t(`op.${op}`)}
                </option>
              ))}
            </select>
            {!OPS_NEEDING_NO_VALUE.includes(row.op) ? (
              <Input
                className="min-w-40 flex-1"
                onChange={(e) =>
                  setRows((prev) =>
                    prev.map((r) => (r.key === row.key ? { ...r, value: e.target.value } : r))
                  )
                }
                placeholder={
                  OPS_NEEDING_LIST.includes(row.op) ? t("valuePlaceholderList") : t("valuePlaceholder")
                }
                value={row.value}
              />
            ) : null}
            <Button
              aria-label={t("removeCondition")}
              onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <Button className="justify-self-start" onClick={() => setRows((prev) => [...prev, newRow()])} type="button" variant="outline">
        <Plus className="size-4" /> {t("addCondition")}
      </Button>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button disabled={isPending} onClick={save} type="button">
          {t("save")}
        </Button>
        <Button disabled={isPending || !folder.matchConditions} onClick={clear} type="button" variant="outline">
          {t("clearPattern")}
        </Button>
      </div>
    </div>
  );
}
