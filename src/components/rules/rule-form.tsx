"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useState, useTransition } from "react";

import { EntityPickerField } from "@/components/rules/entity-picker-field";
import { PaperlessMetaPicker } from "@/components/documents/paperless-meta-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { controlClass } from "@/components/imports/import-controls";
import { TextField } from "@/components/forms/text-field";
import { createRuleAction, updateRuleAction } from "@/modules/rules/rules.actions";
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

type ActionKind = "add_tag" | "remove_tag" | "set_document_type" | "set_correspondent" | "connect_entity" | "disconnect_entity";

type ActionRow = {
  key: string;
  kind: ActionKind;
  metaId: number | null; // add_tag/remove_tag/set_document_type/set_correspondent
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
  return { key: nextKey(), kind: "add_tag", metaId: null, entity: null, relation: "related" };
}

function pickerKindFor(field: ConditionFieldKind | "tag" | "documentType" | "correspondent") {
  if (field === "tags" || field === "tag") return "tag" as const;
  if (field === "documentType") return "documentType" as const;
  return "correspondent" as const;
}

function actionMetaKindFor(kind: ActionKind): "tag" | "correspondent" | "documentType" {
  if (kind === "add_tag" || kind === "remove_tag") return "tag";
  if (kind === "set_document_type") return "documentType";
  return "correspondent";
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
function actionRowsFromDslWithMeta(
  actions: unknown,
  metaOptions: { tags: MetaOption[]; correspondents: MetaOption[]; documentTypes: MetaOption[] }
): ActionRow[] {
  const list = Array.isArray(actions) ? (actions as Array<Record<string, unknown>>) : [];
  const rows = list
    .map((action): ActionRow | null => {
      const type = action.type as ActionKind;
      if (type === "add_tag" || type === "remove_tag") {
        return { key: nextKey(), kind: type, metaId: findMetaIdByName(metaOptions.tags, action.value), entity: null, relation: "related" };
      }
      if (type === "set_document_type") {
        return {
          key: nextKey(),
          kind: type,
          metaId: findMetaIdByName(metaOptions.documentTypes, action.value),
          entity: null,
          relation: "related"
        };
      }
      if (type === "set_correspondent") {
        return {
          key: nextKey(),
          kind: type,
          metaId: findMetaIdByName(metaOptions.correspondents, action.value),
          entity: null,
          relation: "related"
        };
      }
      if (type === "connect_entity" || type === "disconnect_entity") {
        const ref = action.entity_ref as { by?: string; entityId?: string; label?: string } | undefined;
        const relation = (action.relation as (typeof RELATIONS)[number]) ?? "related";
        const entity = ref?.by === "id" && ref.entityId && ref.label ? { id: ref.entityId, label: ref.label } : null;
        return { key: nextKey(), kind: type, metaId: null, entity, relation };
      }
      return null;
    })
    .filter((r): r is ActionRow => r !== null);
  return rows;
}

export function RuleForm({
  initial,
  metaOptions: initialMetaOptions
}: {
  initial?: RuleFormValue;
  metaOptions: { tags: MetaOption[]; correspondents: MetaOption[]; documentTypes: MetaOption[] };
}) {
  const t = useTranslations("rules.form");
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
  const [priority, setPriority] = useState(initial?.priority ?? 100);
  const [conditionRows, setConditionRows] = useState<ConditionRow[]>(() =>
    initial ? conditionRowsFromDslWithMeta(initial.conditions, initialMetaOptions) : [newConditionRow()]
  );
  const [actionRows, setActionRows] = useState<ActionRow[]>(() =>
    initial ? actionRowsFromDslWithMeta(initial.actions, initialMetaOptions) : [newActionRow()]
  );

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
  const actionsValid = actionRows.every((row) =>
    row.kind === "connect_entity" || row.kind === "disconnect_entity" ? row.entity !== null : row.metaId !== null
  );
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

    const actions = actionRows.map((row) => {
      if (row.kind === "add_tag" || row.kind === "remove_tag") {
        return { type: row.kind, value: nameForMetaId("tag", row.metaId) };
      }
      if (row.kind === "set_document_type") {
        return { type: row.kind, value: nameForMetaId("documentType", row.metaId) };
      }
      if (row.kind === "set_correspondent") {
        return { type: row.kind, value: nameForMetaId("correspondent", row.metaId) };
      }
      return {
        type: row.kind,
        entity_ref: { by: "id" as const, entityId: row.entity!.id },
        relation: row.relation
      };
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
          <TextField
            hint={t("priorityHint")}
            label={t("priorityLabel")}
            onChange={(e) => setPriority(Number(e.target.value) || 100)}
            type="number"
            value={priority}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("triggerTitle")}</CardTitle>
          <p className="text-sm text-muted">{t("triggerDescription")}</p>
        </CardHeader>
        <CardContent>
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
                  const kind = e.target.value as ActionKind;
                  setActionRows((rows) =>
                    rows.map((r) => (r.key === row.key ? { ...r, kind, metaId: null, entity: null } : r))
                  );
                }}
                value={row.kind}
              >
                {(
                  ["add_tag", "remove_tag", "set_document_type", "set_correspondent", "connect_entity", "disconnect_entity"] as ActionKind[]
                ).map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`actionKinds.${kind}`)}
                  </option>
                ))}
              </select>

              {row.kind === "connect_entity" || row.kind === "disconnect_entity" ? (
                <div className="grid gap-2 sm:grid-cols-2">
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
                <PaperlessMetaPicker
                  kind={actionMetaKindFor(row.kind)}
                  mode="single"
                  onChange={(ids, newOption) => {
                    if (newOption) addMetaOption(actionMetaKindFor(row.kind), newOption);
                    setActionRows((rows) =>
                      rows.map((r) => (r.key === row.key ? { ...r, metaId: ids[0] ?? null } : r))
                    );
                  }}
                  options={optionsFor(actionMetaKindFor(row.kind))}
                  value={row.metaId !== null ? [row.metaId] : []}
                />
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

      <Button disabled={isPending || !canSubmit} onClick={handleSubmit} type="button">
        {isPending ? t("saving") : initial?.id ? t("save") : t("create")}
      </Button>
    </div>
  );
}
