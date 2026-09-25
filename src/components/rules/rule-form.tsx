"use client";

import { ChevronDown, Play, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";

import { PaperlessMetaPicker } from "@/components/documents/paperless-meta-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TextField } from "@/components/forms/text-field";
import { DeleteRuleButton } from "@/components/rules/delete-rule-button";
import {
  createRuleAction,
  startRuleBackfillFormAction,
  toggleRuleEnabledFormAction,
  updateRuleAction
} from "@/modules/rules/rules.actions";
import {
  RULE_TRIGGERS,
  triggerMessageKey,
  type RuleTrigger
} from "@/modules/rules/rules.schemas";

// Shared form-control styling, inlined here so the rules form stays self-contained.
const controlClass =
  "min-h-11 w-full min-w-0 rounded-md border border-border bg-panel px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";

type MetaOption = { id: number; name: string; color?: string; text_color?: string };

// The five DSL fields specs/07-rules-engine.md's condition table exposes that map onto a plain
// document (not custom fields — a deliberate v1 scope cut, see docs/IMPLEMENTATION_PLAN.md). Each
// has its own small operator set and value control, not the DSL's full 17-operator vocabulary —
// the raw JSON/full DSL still exists server-side, this is a guided subset over it.
type ConditionFieldKind = "filename" | "content" | "tags" | "documentType";
type ConditionOp = "contains" | "not_contains" | "eq" | "neq";

const CONDITION_FIELD_TO_DSL: Record<ConditionFieldKind, string> = {
  filename: "document.filename",
  content: "document.content",
  tags: "document.tags",
  documentType: "document.type"
};

const CONDITION_OPS_BY_FIELD: Record<ConditionFieldKind, ConditionOp[]> = {
  filename: ["contains", "not_contains", "eq", "neq"],
  content: ["contains", "not_contains", "eq", "neq"],
  tags: ["contains", "not_contains"],
  documentType: ["eq", "neq"]
};

type ConditionRow = {
  key: string;
  field: ConditionFieldKind;
  op: ConditionOp;
  text: string; // filename/content
  metaId: number | null; // tags/documentType
};

type AttributeKind = "tag" | "documentType";
type AttributeOperation = "assign" | "remove";

type ActionRow = {
  key: string;
  attributeKind: AttributeKind;
  attributeOperation: AttributeOperation;
  metaId: number | null; // documentType — a document can only have one
  metaIds: number[]; // tag — a document can carry any number of tags, so this row can assign/remove several at once
};

type RuleSection = "basics" | "conditions" | "actions";

function RuleAccordionSection({
  id,
  open,
  title,
  description,
  summary,
  onOpenChange,
  children
}: {
  id: RuleSection;
  open: boolean;
  title: string;
  description?: string;
  summary?: string;
  onOpenChange: (id: RuleSection) => void;
  children: ReactNode;
}) {
  return (
    <Card className={`overflow-hidden ${open ? "flex min-h-0 flex-1 flex-col" : "shrink-0"}`}>
      <CardHeader className="p-0">
        <button
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-panel-strong/40"
          onClick={() => onOpenChange(id)}
          type="button"
        >
          <span className="min-w-0">
            <CardTitle>{title}</CardTitle>
            {open && description ? (
              <span className="mt-1 block text-sm text-muted">{description}</span>
            ) : null}
            {!open && summary ? (
              <span className="mt-1 block text-sm text-muted">{summary}</span>
            ) : null}
          </span>
          <ChevronDown
            className={`size-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </CardHeader>
      {open ? <div className="min-h-0 flex-1 overflow-y-auto">{children}</div> : null}
    </Card>
  );
}

let rowCounter = 0;
function nextKey(): string {
  rowCounter += 1;
  return `row-${rowCounter}`;
}

function newConditionRow(): ConditionRow {
  return { key: nextKey(), field: "filename", op: "contains", text: "", metaId: null };
}

function newActionRow(): ActionRow {
  return {
    key: nextKey(),
    attributeKind: "tag",
    attributeOperation: "assign",
    metaId: null,
    metaIds: []
  };
}

function pickerKindFor(field: ConditionFieldKind | "tag" | "documentType") {
  if (field === "tags" || field === "tag") return "tag" as const;
  return "documentType" as const;
}

export type RuleFormValue = {
  id?: string;
  name: string;
  trigger: RuleTrigger;
  priority: number;
  conditions: unknown;
  actions: unknown;
};

function findMetaIdByName(options: MetaOption[], name: unknown): number | null {
  if (typeof name !== "string" || !name.trim()) return null;
  return options.find((o) => o.name.toLowerCase() === name.toLowerCase())?.id ?? null;
}

// Hydrates an existing rule's raw DSL back into row state for editing. Condition/action *values*
// are DSL-level names (e.g. a tag's name string), not ids, so this resolves each one against the
// live options list by name — a value that no longer matches anything (renamed/deleted since the
// rule was saved) comes back unresolved (metaId: null) rather than silently guessing, which
// canSubmit's validation then surfaces as an incomplete row needing attention.
function conditionRowsFromDslWithMeta(
  conditions: unknown,
  metaOptions: { tags: MetaOption[]; documentTypes: MetaOption[] }
): ConditionRow[] {
  const node = conditions as { all?: Array<{ field: string; op: string; value?: unknown }> } | null;
  if (!node || !Array.isArray(node.all)) return [newConditionRow()];

  const dslToField = Object.fromEntries(
    Object.entries(CONDITION_FIELD_TO_DSL).map(([k, v]) => [v, k as ConditionFieldKind])
  );

  const rows = node.all
    .map((leaf): ConditionRow | null => {
      const field = dslToField[leaf.field];
      if (!field) return null;
      const op = (["contains", "not_contains", "eq", "neq"] as const).includes(
        leaf.op as ConditionOp
      )
        ? (leaf.op as ConditionOp)
        : "contains";

      if (field === "tags") {
        return {
          key: nextKey(),
          field,
          op,
          text: "",
          metaId: findMetaIdByName(metaOptions.tags, leaf.value)
        };
      }
      if (field === "documentType") {
        return {
          key: nextKey(),
          field,
          op,
          text: "",
          metaId: findMetaIdByName(metaOptions.documentTypes, leaf.value)
        };
      }
      return { key: nextKey(), field, op, text: String(leaf.value ?? ""), metaId: null };
    })
    .filter((r): r is ConditionRow => r !== null);

  return rows.length > 0 ? rows : [newConditionRow()];
}

// add_tag/remove_tag stay one-DSL-action-per-tag server-side (specs/07's own action shape) —
// this UI groups them into one row per contiguous same-operation run so "assign tags A, B, C"
// edits as a single multi-select row instead of three separate ones. A rule authored outside
// this builder with tag actions interleaved with other action types would split back into
// multiple rows on hydration rather than merging non-contiguous ones — a reasonable degradation
// for a guided subset over the full DSL, not a data-loss risk (every action still round-trips).
function actionRowsFromDslWithMeta(
  actions: unknown,
  metaOptions: { tags: MetaOption[]; documentTypes: MetaOption[] }
): ActionRow[] {
  const list = Array.isArray(actions) ? (actions as Array<Record<string, unknown>>) : [];
  const rows: ActionRow[] = [];
  let i = 0;
  while (i < list.length) {
    const action = list[i];
    const type = action.type as string;

    if (type === "add_tag" || type === "remove_tag") {
      const metaIds: number[] = [];
      while (i < list.length && list[i].type === type) {
        const id = findMetaIdByName(metaOptions.tags, list[i].value);
        if (id !== null) metaIds.push(id);
        i += 1;
      }
      rows.push({
        ...newActionRow(),
        key: nextKey(),
        attributeKind: "tag",
        attributeOperation: type === "remove_tag" ? "remove" : "assign",
        metaIds
      });
      continue;
    }

    i += 1;
    if (type === "set_document_type") {
      rows.push({
        ...newActionRow(),
        key: nextKey(),
        attributeKind: "documentType",
        metaId: findMetaIdByName(metaOptions.documentTypes, action.value),
        attributeOperation: "assign"
      });
      continue;
    }
  }
  return rows;
}

function serializeConditionRows(rows: ConditionRow[]) {
  return rows.map((row) => ({
    field: row.field,
    op: row.op,
    text: row.text,
    metaId: row.metaId
  }));
}

function serializeActionRows(rows: ActionRow[]) {
  return rows.map((row) => ({
    attributeKind: row.attributeKind,
    attributeOperation: row.attributeOperation,
    metaId: row.metaId,
    metaIds: row.metaIds
  }));
}

export function RuleForm({
  enabled,
  initial,
  metaOptions: initialMetaOptions,
  showHeader = true
}: {
  enabled?: boolean;
  initial?: RuleFormValue;
  metaOptions: { tags: MetaOption[]; documentTypes: MetaOption[] };
  showHeader?: boolean;
}) {
  const t = useTranslations("rules.form");
  const tDetail = useTranslations("rules.detail");
  const tList = useTranslations("rules.list");
  const tTriggers = useTranslations("rules.triggers");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Local state, not just the server-fetched prop — PaperlessMetaPicker's "create new" flow
  // (kind="tag" etc.) creates a real Paperless object and hands it back via onChange's second
  // argument, but never re-fetches the server-rendered options list. Without mirroring that
  // creation into this state too, a tag/type created *during this session* would
  // resolve to an empty name at submit time (nameForMetaId() couldn't find it in the stale
  // list) — a real bug caught by an actual browser walkthrough, not by typecheck/lint/tests.
  const [metaOptions, setMetaOptions] = useState(initialMetaOptions);

  function addMetaOption(kind: "tag" | "documentType", option: MetaOption) {
    setMetaOptions((prev) => {
      const key = kind === "tag" ? "tags" : "documentTypes";
      if (prev[key].some((o) => o.id === option.id)) return prev;
      return { ...prev, [key]: [...prev[key], option] };
    });
  }

  const [name, setName] = useState(initial?.name ?? "");
  const [trigger, setTrigger] = useState<RuleTrigger>(initial?.trigger ?? "document.ingested");
  const [openSection, setOpenSection] = useState<RuleSection>("basics");
  const priority = initial?.priority ?? 100;
  const [conditionRows, setConditionRows] = useState<ConditionRow[]>(() =>
    initial
      ? conditionRowsFromDslWithMeta(initial.conditions, initialMetaOptions)
      : [newConditionRow()]
  );
  const [actionRows, setActionRows] = useState<ActionRow[]>(() =>
    initial ? actionRowsFromDslWithMeta(initial.actions, initialMetaOptions) : [newActionRow()]
  );
  const [initialSignature] = useState(() =>
    initial
      ? JSON.stringify({
          name: initial.name,
          trigger: initial.trigger,
          conditions: serializeConditionRows(conditionRows),
          actions: serializeActionRows(actionRows)
        })
      : ""
  );

  const currentSignature = useMemo(
    () =>
      JSON.stringify({
        name,
        trigger,
        conditions: serializeConditionRows(conditionRows),
        actions: serializeActionRows(actionRows)
      }),
    [actionRows, conditionRows, name, trigger]
  );
  const hasChanges = !initial || currentSignature !== initialSignature;

  function optionsFor(kind: "tag" | "documentType"): MetaOption[] {
    if (kind === "tag") return metaOptions.tags;
    return metaOptions.documentTypes;
  }

  function nameForMetaId(
    kind: "tag" | "documentType",
    id: number | null
  ): string {
    if (id === null) return "";
    return optionsFor(kind).find((o) => o.id === id)?.name ?? "";
  }

  const conditionsValid = conditionRows.every((row) =>
    row.field === "tags" || row.field === "documentType"
      ? row.metaId !== null
      : row.text.trim().length > 0
  );
  const actionsValid = actionRows.every((row) => {
    if (row.attributeKind === "tag") return row.metaIds.length > 0;
    // Removing a document type clears it — there's no value to pick, so the row
    // is already complete as soon as that combination is chosen.
    if (row.attributeOperation === "remove") return true;
    return row.metaId !== null;
  });
  const canSubmit =
    name.trim().length > 0 &&
    conditionRows.length > 0 &&
    actionRows.length > 0 &&
    conditionsValid &&
    actionsValid;

  function handleSubmit() {
    if (!canSubmit) return;
    setError(null);

    const conditions = {
      all: conditionRows.map((row) => {
        const isMeta = row.field === "tags" || row.field === "documentType";
        return {
          field: CONDITION_FIELD_TO_DSL[row.field],
          op: row.op,
          value: isMeta ? nameForMetaId(pickerKindFor(row.field), row.metaId) : row.text
        };
      })
    };

    const actions = actionRows.flatMap((row): Record<string, unknown>[] => {
      if (row.attributeKind === "tag") {
        // One DSL action per selected tag — the multi-select row expands to N add_tag/
        // remove_tag actions, since specs/07's action shape has no "list of tags" variant.
        const type = row.attributeOperation === "remove" ? "remove_tag" : "add_tag";
        return row.metaIds.map((id) => ({ type, value: nameForMetaId("tag", id) }));
      }
      const actionType = "set_document_type";
      const value = row.attributeOperation === "remove" ? null : nameForMetaId("documentType", row.metaId);
      return [{ type: actionType, value }];
    });

    startTransition(async () => {
      const input = { name: name.trim(), trigger, priority, conditions, actions };
      const response = initial?.id
        ? await updateRuleAction(initial.id, input)
        : await createRuleAction(input);
      if (response.error) {
        setError(response.error);
        return;
      }
      router.push(`/dashboard/rules/${(response.data as { id: string }).id}`);
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-0 flex-col gap-4 lg:h-full">
      {initial?.id && showHeader ? (
        <div className="flex flex-col items-center justify-between gap-3 text-center sm:flex-row sm:items-start sm:text-left">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="min-w-0 truncate text-3xl font-black">{name || initial.name}</h1>
              <Badge variant={enabled ? "accent" : "muted"}>
                {enabled ? tList("enabled") : tList("disabled")}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted">
              {tList("trigger", { trigger: tTriggers(triggerMessageKey(trigger)) })}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-end">
            {hasChanges ? (
              <Button disabled={isPending || !canSubmit} onClick={handleSubmit} type="button">
                {isPending ? t("saving") : t("save")}
              </Button>
            ) : null}
            <form action={startRuleBackfillFormAction}>
              <input name="ruleId" type="hidden" value={initial.id} />
              <Button type="submit" variant="outline">
                <Play aria-hidden className="size-4" />
                {tDetail("trigger")}
              </Button>
            </form>
            <form action={toggleRuleEnabledFormAction}>
              <input name="ruleId" type="hidden" value={initial.id} />
              <input name="enabled" type="hidden" value={(!enabled).toString()} />
              <Button type="submit" variant="outline">
                {enabled ? tDetail("disable") : tDetail("enable")}
              </Button>
            </form>
            <DeleteRuleButton ruleId={initial.id} />
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <RuleAccordionSection
          id="basics"
          onOpenChange={setOpenSection}
          open={openSection === "basics"}
          summary={`${name || t("namePlaceholder")} · ${tTriggers(triggerMessageKey(trigger))}`}
          title={t("basicsTitle")}
        >
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t("nameLabel")}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              value={name}
            />
            <label className="grid gap-2 text-sm font-semibold">
              <span>{t("triggerTitle")}</span>
              <select
                className="min-h-11 rounded-md border border-border bg-panel px-3 text-base font-normal outline-none transition focus:border-foreground focus:ring-2 focus:ring-foreground/15"
                onChange={(e) => setTrigger(e.target.value as RuleTrigger)}
                value={trigger}
              >
                {RULE_TRIGGERS.map((value) => (
                  <option key={value} value={value}>
                    {tTriggers(triggerMessageKey(value))}
                  </option>
                ))}
              </select>
            </label>
          </CardContent>
        </RuleAccordionSection>

        <RuleAccordionSection
          description={t("conditionsDescription")}
          id="conditions"
          onOpenChange={setOpenSection}
          open={openSection === "conditions"}
          summary={t("sectionSummary.conditions", { count: conditionRows.length })}
          title={t("conditionsTitle")}
        >
          <CardContent className="grid gap-3">
            {conditionRows.map((row, index) => (
              <div
                className="grid gap-2 rounded-md border border-border bg-panel p-3"
                key={row.key}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {t("conditionNumber", { number: index + 1 })}
                  </span>
                  <Button
                    aria-label={t("removeCondition")}
                    onClick={() =>
                      setConditionRows((rows) => rows.filter((r) => r.key !== row.key))
                    }
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <select
                    aria-label={t("conditionFieldLabel")}
                    className={controlClass}
                    onChange={(e) => {
                      const field = e.target.value as ConditionFieldKind;
                      setConditionRows((rows) =>
                        rows.map((r) =>
                          r.key === row.key
                            ? {
                                ...r,
                                field,
                                op: CONDITION_OPS_BY_FIELD[field][0],
                                text: "",
                                metaId: null
                              }
                            : r
                        )
                      );
                    }}
                    value={row.field}
                  >
                    {(Object.keys(CONDITION_FIELD_TO_DSL) as ConditionFieldKind[]).map((field) => (
                      <option key={field} value={field}>
                        {t(`conditionFields.${field}`)}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={t("conditionOperatorLabel")}
                    className={controlClass}
                    onChange={(e) =>
                      setConditionRows((rows) =>
                        rows.map((r) =>
                          r.key === row.key ? { ...r, op: e.target.value as ConditionOp } : r
                        )
                      )
                    }
                    value={row.op}
                  >
                    {CONDITION_OPS_BY_FIELD[row.field].map((op) => (
                      <option key={op} value={op}>
                        {t(`conditionOps.${op}`)}
                      </option>
                    ))}
                  </select>
                </div>
                {row.field === "tags" ||
                row.field === "documentType" ? (
                  <PaperlessMetaPicker
                    kind={pickerKindFor(row.field)}
                    mode="single"
                    onChange={(ids, newOption) => {
                      if (newOption) addMetaOption(pickerKindFor(row.field), newOption);
                      setConditionRows((rows) =>
                        rows.map((r) => (r.key === row.key ? { ...r, metaId: ids[0] ?? null } : r))
                      );
                    }}
                    options={optionsFor(pickerKindFor(row.field))}
                    value={row.metaId !== null ? [row.metaId] : []}
                  />
                ) : (
                  <input
                    aria-label={t("conditionValueLabel")}
                    className={controlClass}
                    onChange={(e) =>
                      setConditionRows((rows) =>
                        rows.map((r) => (r.key === row.key ? { ...r, text: e.target.value } : r))
                      )
                    }
                    placeholder={t("conditionValuePlaceholder")}
                    value={row.text}
                  />
                )}
              </div>
            ))}
            <Button
              className="justify-self-start"
              onClick={() => setConditionRows((rows) => [...rows, newConditionRow()])}
              type="button"
              variant="outline"
            >
              <Plus className="size-4" />
              {t("addCondition")}
            </Button>
          </CardContent>
        </RuleAccordionSection>

        <RuleAccordionSection
          description={t("actionsDescription")}
          id="actions"
          onOpenChange={setOpenSection}
          open={openSection === "actions"}
          summary={t("sectionSummary.actions", { count: actionRows.length })}
          title={t("actionsTitle")}
        >
          <CardContent className="grid gap-3">
            {actionRows.map((row, index) => (
              <div
                className="grid gap-2 rounded-md border border-border bg-panel p-3"
                key={row.key}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {t("actionNumber", { number: index + 1 })}
                  </span>
                  <Button
                    aria-label={t("removeAction")}
                    onClick={() => setActionRows((rows) => rows.filter((r) => r.key !== row.key))}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-[220px_220px_1fr]">
                    <select
                      aria-label={t("attributeOperationLabel")}
                      className={controlClass}
                      onChange={(e) => {
                        const operation = e.target.value as AttributeOperation;
                        setActionRows((rows) =>
                          rows.map((r) =>
                            r.key === row.key
                              ? { ...r, attributeOperation: operation, metaId: null, metaIds: [] }
                              : r
                          )
                        );
                      }}
                      value={row.attributeOperation}
                    >
                      <option value="assign">{t("attributeOperations.assign")}</option>
                      <option value="remove">{t("attributeOperations.remove")}</option>
                    </select>
                    <select
                      aria-label={t("attributeKindLabel")}
                      className={controlClass}
                      onChange={(e) =>
                        setActionRows((rows) =>
                          rows.map((r) =>
                            r.key === row.key
                              ? {
                                  ...r,
                                  attributeKind: e.target.value as AttributeKind,
                                  metaId: null,
                                  metaIds: []
                                }
                              : r
                          )
                        )
                      }
                      value={row.attributeKind}
                    >
                      <option value="tag">{t("attributeKinds.tag")}</option>
                      <option value="documentType">{t("attributeKinds.documentType")}</option>
                    </select>
                    {row.attributeKind === "tag" ? (
                      <PaperlessMetaPicker
                        kind="tag"
                        mode="multi"
                        onChange={(ids, newOption) => {
                          if (newOption) addMetaOption("tag", newOption);
                          setActionRows((rows) =>
                            rows.map((r) => (r.key === row.key ? { ...r, metaIds: ids } : r))
                          );
                        }}
                        options={optionsFor("tag")}
                        value={row.metaIds}
                      />
                    ) : row.attributeOperation === "remove" ? (
                      // A document type is a single nullable field — "remove" always
                      // means "clear it," so there's nothing to pick.
                      <p className="flex items-center text-sm text-muted">
                        {t("attributeRemoveClearsValue")}
                      </p>
                    ) : (
                      <PaperlessMetaPicker
                        kind={row.attributeKind}
                        mode="single"
                        onChange={(ids, newOption) => {
                          if (newOption) addMetaOption(row.attributeKind, newOption);
                          setActionRows((rows) =>
                            rows.map((r) =>
                              r.key === row.key ? { ...r, metaId: ids[0] ?? null } : r
                            )
                          );
                        }}
                        options={optionsFor(row.attributeKind)}
                        value={row.metaId !== null ? [row.metaId] : []}
                      />
                    )}
                  </div>
              </div>
            ))}
            <Button
              className="justify-self-start"
              onClick={() => setActionRows((rows) => [...rows, newActionRow()])}
              type="button"
              variant="outline"
            >
              <Plus className="size-4" />
              {t("addAction")}
            </Button>
          </CardContent>
        </RuleAccordionSection>
      </div>

      <div className="grid shrink-0 gap-2">
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {!canSubmit && (conditionRows.length === 0 || actionRows.length === 0) ? (
          <p className="text-sm text-muted">{t("needsConditionAndAction")}</p>
        ) : null}

        {(!initial || hasChanges) && !showHeader ? (
          <Button
            className="justify-self-center sm:justify-self-start"
            disabled={isPending || !canSubmit}
            onClick={handleSubmit}
            type="button"
          >
            {isPending ? t("saving") : initial ? t("save") : t("create")}
          </Button>
        ) : null}
        {!initial && showHeader ? (
          <Button
            className="justify-self-center sm:justify-self-start"
            disabled={isPending || !canSubmit}
            onClick={handleSubmit}
            type="button"
          >
            {isPending ? t("saving") : t("create")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
