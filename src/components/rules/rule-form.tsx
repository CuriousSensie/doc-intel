"use client";

import { Play, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useMemo, useState, useTransition } from "react";

import { EntityPickerField } from "@/components/rules/entity-picker-field";
import { PaperlessMetaPicker } from "@/components/documents/paperless-meta-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { controlClass } from "@/components/imports/import-controls";
import { TextField } from "@/components/forms/text-field";
import { DeleteRuleButton } from "@/components/rules/delete-rule-button";
import {
  createRuleAction,
  startRuleBackfillFormAction,
  toggleRuleEnabledFormAction,
  updateRuleAction
} from "@/modules/rules/rules.actions";
import { RELATIONS, RULE_TRIGGERS, triggerMessageKey, type RuleTrigger } from "@/modules/rules/rules.schemas";

type MetaOption = { id: number; name: string; color?: string; text_color?: string };

// The five DSL fields specs/07-rules-engine.md's condition table exposes that map onto a plain
// document (not entity.*/connection.count/custom fields — a deliberate v1 scope cut, see
// docs/IMPLEMENTATION_PLAN.md). Each has its own small operator set and value control, not the
// DSL's full 17-operator vocabulary — the raw JSON/full DSL still exists server-side, this is a
// guided subset over it.
type ConditionFieldKind = "filename" | "content" | "tags" | "correspondent" | "documentType";
type ConditionOp = "contains" | "not_contains" | "eq" | "neq";

const CONDITION_FIELD_TO_DSL: Record<ConditionFieldKind, string> = {
  filename: "document.filename",
  content: "document.content",
  tags: "document.tags",
  correspondent: "document.correspondent",
  documentType: "document.type"
};

const CONDITION_OPS_BY_FIELD: Record<ConditionFieldKind, ConditionOp[]> = {
  filename: ["contains", "not_contains", "eq", "neq"],
  content: ["contains", "not_contains", "eq", "neq"],
  tags: ["contains", "not_contains"],
  correspondent: ["eq", "neq"],
  documentType: ["eq", "neq"]
};

type ConditionRow = {
  key: string;
  field: ConditionFieldKind;
  op: ConditionOp;
  text: string; // filename/content
  metaId: number | null; // tags/correspondent/documentType
};

type AttributeKind = "tag" | "correspondent" | "documentType";
type AttributeOperation = "assign" | "remove";
type EntityOperation = "connect" | "disconnect";

type ActionRow = {
  key: string;
  mode: "attribute" | "entity";
  attributeKind: AttributeKind;
  attributeOperation: AttributeOperation;
  metaId: number | null; // correspondent/documentType — a document can only have one of each
  metaIds: number[]; // tag — a document can carry any number of tags, so this row can assign/remove several at once
  entityOperation: EntityOperation;
  entity: { id: string; label: string } | null; // connect_entity/disconnect_entity
  relation: (typeof RELATIONS)[number];
};

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
    mode: "attribute",
    attributeKind: "tag",
    attributeOperation: "assign",
    metaId: null,
    metaIds: [],
    entityOperation: "connect",
    entity: null,
    relation: "related"
  };
}

function pickerKindFor(field: ConditionFieldKind | "tag" | "documentType" | "correspondent") {
  if (field === "tags" || field === "tag") return "tag" as const;
  if (field === "documentType") return "documentType" as const;
  return "correspondent" as const;
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
  metaOptions: { tags: MetaOption[]; correspondents: MetaOption[]; documentTypes: MetaOption[] }
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
      const op = (["contains", "not_contains", "eq", "neq"] as const).includes(leaf.op as ConditionOp)
        ? (leaf.op as ConditionOp)
        : "contains";

      if (field === "tags") {
        return { key: nextKey(), field, op, text: "", metaId: findMetaIdByName(metaOptions.tags, leaf.value) };
      }
      if (field === "correspondent") {
        return {
          key: nextKey(),
          field,
          op,
          text: "",
          metaId: findMetaIdByName(metaOptions.correspondents, leaf.value)
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

// entity_ref for connect_entity/disconnect_entity is {by:"id", entityId} when authored through
// this builder — the caller (rules/[id]/page.tsx) enriches it server-side with the entity's
// current display name (`label`) before passing it here, since the builder has no other way to
// show a human-readable chip for a bare id. A `by:"identifier"`/`by:"name"` ref (possible if the
// rule predates this UI, or was hand-authored) has no single resolvable id to preselect — that
// row comes back with entity: null, a reasonable degradation rather than a crash.
// add_tag/remove_tag stay one-DSL-action-per-tag server-side (specs/07's own action shape) —
// this UI groups them into one row per contiguous same-operation run so "assign tags A, B, C"
// edits as a single multi-select row instead of three separate ones. A rule authored outside
// this builder with tag actions interleaved with other action types would split back into
// multiple rows on hydration rather than merging non-contiguous ones — a reasonable degradation
// for a guided subset over the full DSL, not a data-loss risk (every action still round-trips).
function actionRowsFromDslWithMeta(
  actions: unknown,
  metaOptions: { tags: MetaOption[]; correspondents: MetaOption[]; documentTypes: MetaOption[] }
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
    if (type === "set_correspondent") {
      rows.push({
        ...newActionRow(),
        key: nextKey(),
        attributeKind: "correspondent",
        metaId: findMetaIdByName(metaOptions.correspondents, action.value),
        attributeOperation: "assign"
      });
      continue;
    }
    if (type === "connect_entity" || type === "disconnect_entity") {
      const ref = action.entity_ref as { by?: string; entityId?: string; label?: string } | undefined;
      const relation = (action.relation as (typeof RELATIONS)[number]) ?? "related";
      const entity = ref?.by === "id" && ref.entityId && ref.label ? { id: ref.entityId, label: ref.label } : null;
      rows.push({
        ...newActionRow(),
        key: nextKey(),
        mode: "entity",
        entityOperation: type === "disconnect_entity" ? "disconnect" : "connect",
        entity,
        relation
      });
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
    mode: row.mode,
    attributeKind: row.attributeKind,
    attributeOperation: row.attributeOperation,
    metaId: row.metaId,
    metaIds: row.metaIds,
    entityOperation: row.entityOperation,
    entityId: row.entity?.id ?? null,
    relation: row.relation
  }));
}

export function RuleForm({
  enabled,
  initial,
  metaOptions: initialMetaOptions
}: {
  enabled?: boolean;
  initial?: RuleFormValue;
  metaOptions: { tags: MetaOption[]; correspondents: MetaOption[]; documentTypes: MetaOption[] };
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
  // creation into this state too, a tag/type/correspondent created *during this session* would
  // resolve to an empty name at submit time (nameForMetaId() couldn't find it in the stale
  // list) — a real bug caught by an actual browser walkthrough, not by typecheck/lint/tests.
  const [metaOptions, setMetaOptions] = useState(initialMetaOptions);

  function addMetaOption(kind: "tag" | "correspondent" | "documentType", option: MetaOption) {
    setMetaOptions((prev) => {
      const key = kind === "tag" ? "tags" : kind === "correspondent" ? "correspondents" : "documentTypes";
      if (prev[key].some((o) => o.id === option.id)) return prev;
      return { ...prev, [key]: [...prev[key], option] };
    });
  }

  const [name, setName] = useState(initial?.name ?? "");
  const [trigger, setTrigger] = useState<RuleTrigger>(initial?.trigger ?? "document.ingested");
  const priority = initial?.priority ?? 100;
  const [conditionRows, setConditionRows] = useState<ConditionRow[]>(() =>
    initial ? conditionRowsFromDslWithMeta(initial.conditions, initialMetaOptions) : [newConditionRow()]
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

  function optionsFor(kind: "tag" | "correspondent" | "documentType"): MetaOption[] {
    if (kind === "tag") return metaOptions.tags;
    if (kind === "correspondent") return metaOptions.correspondents;
    return metaOptions.documentTypes;
  }

  function nameForMetaId(kind: "tag" | "correspondent" | "documentType", id: number | null): string {
    if (id === null) return "";
    return optionsFor(kind).find((o) => o.id === id)?.name ?? "";
  }

  const conditionsValid = conditionRows.every((row) =>
    row.field === "tags" || row.field === "correspondent" || row.field === "documentType"
      ? row.metaId !== null
      : row.text.trim().length > 0
  );
  const actionsValid = actionRows.every((row) => {
    if (row.mode === "entity") return row.entity !== null;
    if (row.attributeKind === "tag") return row.metaIds.length > 0;
    // Removing a document type/correspondent clears it — there's no value to pick, so the row
    // is already complete as soon as that combination is chosen.
    if (row.attributeOperation === "remove") return true;
    return row.metaId !== null;
  });
  const canSubmit = name.trim().length > 0 && conditionRows.length > 0 && actionRows.length > 0 && conditionsValid && actionsValid;

  function handleSubmit() {
    if (!canSubmit) return;
    setError(null);

    const conditions = {
      all: conditionRows.map((row) => {
        const isMeta = row.field === "tags" || row.field === "correspondent" || row.field === "documentType";
        return {
          field: CONDITION_FIELD_TO_DSL[row.field],
          op: row.op,
          value: isMeta ? nameForMetaId(pickerKindFor(row.field), row.metaId) : row.text
        };
      })
    };

    const actions = actionRows.flatMap((row): Record<string, unknown>[] => {
      if (row.mode === "attribute") {
        if (row.attributeKind === "tag") {
          // One DSL action per selected tag — the multi-select row expands to N add_tag/
          // remove_tag actions, since specs/07's action shape has no "list of tags" variant.
          const type = row.attributeOperation === "remove" ? "remove_tag" : "add_tag";
          return row.metaIds.map((id) => ({ type, value: nameForMetaId("tag", id) }));
        }
        const kind = row.attributeKind === "documentType" ? "documentType" : "correspondent";
        const actionType = kind === "documentType" ? "set_document_type" : "set_correspondent";
        const value = row.attributeOperation === "remove" ? null : nameForMetaId(kind, row.metaId);
        return [{ type: actionType, value }];
      }

      return [
        {
          type: row.entityOperation === "disconnect" ? "disconnect_entity" : "connect_entity",
          entity_ref: { by: "id" as const, entityId: row.entity!.id },
          relation: row.relation
        }
      ];
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
    <div className="grid gap-5">
      {initial?.id ? (
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
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
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
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

      <Card>
        <CardHeader>
          <CardTitle>{t("basicsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("nameLabel")}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            value={name}
          />
          <select
            aria-label={t("triggerTitle")}
            className={controlClass}
            onChange={(e) => setTrigger(e.target.value as RuleTrigger)}
            value={trigger}
          >
            {RULE_TRIGGERS.map((value) => (
              <option key={value} value={value}>
                {tTriggers(triggerMessageKey(value))}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("conditionsTitle")}</CardTitle>
          <p className="text-sm text-muted">{t("conditionsDescription")}</p>
        </CardHeader>
        <CardContent className="grid gap-3">
          {conditionRows.map((row, index) => (
            <div className="grid gap-2 rounded-md border border-border bg-panel p-3" key={row.key}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {t("conditionNumber", { number: index + 1 })}
                </span>
                <Button
                  aria-label={t("removeCondition")}
                  onClick={() => setConditionRows((rows) => rows.filter((r) => r.key !== row.key))}
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
                          ? { ...r, field, op: CONDITION_OPS_BY_FIELD[field][0], text: "", metaId: null }
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
                      rows.map((r) => (r.key === row.key ? { ...r, op: e.target.value as ConditionOp } : r))
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
              {row.field === "tags" || row.field === "correspondent" || row.field === "documentType" ? (
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
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("actionsTitle")}</CardTitle>
          <p className="text-sm text-muted">{t("actionsDescription")}</p>
        </CardHeader>
        <CardContent className="grid gap-3">
          {actionRows.map((row, index) => (
            <div className="grid gap-2 rounded-md border border-border bg-panel p-3" key={row.key}>
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
              <select
                aria-label={t("actionKindLabel")}
                className={controlClass}
                onChange={(e) => {
                  const mode = e.target.value as ActionRow["mode"];
                  setActionRows((rows) =>
                    rows.map((r) =>
                      r.key === row.key
                        ? {
                            ...r,
                            mode,
                            metaId: null,
                            entity: null,
                            attributeKind: "tag",
                            attributeOperation: "assign",
                            entityOperation: "connect"
                          }
                        : r
                    )
                  );
                }}
                value={row.mode}
              >
                <option value="attribute">{t("actionModes.attribute")}</option>
                <option value="entity">{t("actionModes.entity")}</option>
              </select>

              {row.mode === "entity" ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  <select
                    aria-label={t("entityOperationLabel")}
                    className={controlClass}
                    onChange={(e) =>
                      setActionRows((rows) =>
                        rows.map((r) =>
                          r.key === row.key ? { ...r, entityOperation: e.target.value as EntityOperation } : r
                        )
                      )
                    }
                    value={row.entityOperation}
                  >
                    <option value="connect">{t("entityOperations.connect")}</option>
                    <option value="disconnect">{t("entityOperations.disconnect")}</option>
                  </select>
                  <EntityPickerField
                    onSelect={(entity) =>
                      setActionRows((rows) => rows.map((r) => (r.key === row.key ? { ...r, entity } : r)))
                    }
                    value={row.entity}
                  />
                  <select
                    aria-label={t("relationLabel")}
                    className={controlClass}
                    onChange={(e) =>
                      setActionRows((rows) =>
                        rows.map((r) =>
                          r.key === row.key ? { ...r, relation: e.target.value as (typeof RELATIONS)[number] } : r
                        )
                      )
                    }
                    value={row.relation}
                  >
                    {RELATIONS.map((relation) => (
                      <option key={relation} value={relation}>
                        {t(`relations.${relation}`)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-[220px_220px_1fr]">
                  <select
                    aria-label={t("attributeOperationLabel")}
                    className={controlClass}
                    onChange={(e) => {
                      const operation = e.target.value as AttributeOperation;
                      setActionRows((rows) =>
                        rows.map((r) => (r.key === row.key ? { ...r, attributeOperation: operation, metaId: null, metaIds: [] } : r))
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
                            ? { ...r, attributeKind: e.target.value as AttributeKind, metaId: null, metaIds: [] }
                            : r
                        )
                      )
                    }
                    value={row.attributeKind}
                  >
                    <option value="tag">{t("attributeKinds.tag")}</option>
                    <option value="correspondent">{t("attributeKinds.correspondent")}</option>
                    <option value="documentType">{t("attributeKinds.documentType")}</option>
                  </select>
                  {row.attributeKind === "tag" ? (
                    <PaperlessMetaPicker
                      kind="tag"
                      mode="multi"
                      onChange={(ids, newOption) => {
                        if (newOption) addMetaOption("tag", newOption);
                        setActionRows((rows) => rows.map((r) => (r.key === row.key ? { ...r, metaIds: ids } : r)));
                      }}
                      options={optionsFor("tag")}
                      value={row.metaIds}
                    />
                  ) : row.attributeOperation === "remove" ? (
                    // A document type/correspondent is a single nullable field — "remove" always
                    // means "clear it," so there's nothing to pick.
                    <p className="flex items-center text-sm text-muted">{t("attributeRemoveClearsValue")}</p>
                  ) : (
                    <PaperlessMetaPicker
                      kind={row.attributeKind}
                      mode="single"
                      onChange={(ids, newOption) => {
                        if (newOption) addMetaOption(row.attributeKind, newOption);
                        setActionRows((rows) =>
                          rows.map((r) => (r.key === row.key ? { ...r, metaId: ids[0] ?? null } : r))
                        );
                      }}
                      options={optionsFor(row.attributeKind)}
                      value={row.metaId !== null ? [row.metaId] : []}
                    />
                  )}
                </div>
              )}
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
      </Card>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!canSubmit && (conditionRows.length === 0 || actionRows.length === 0) ? (
        <p className="text-sm text-muted">{t("needsConditionAndAction")}</p>
      ) : null}

      {!initial ? (
        <Button disabled={isPending || !canSubmit} onClick={handleSubmit} type="button">
          {isPending ? t("saving") : t("create")}
        </Button>
      ) : null}
    </div>
  );
}
