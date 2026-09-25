import { z } from "zod";

// specs/07-rules-engine.md §Triggers — matches rules.trigger's CHECK constraint
// (20260918000000_rules_engine.sql).
export const RULE_TRIGGERS = [
  "document.ingested",
  "document.updated",
  "manual"
] as const;
export type RuleTrigger = (typeof RULE_TRIGGERS)[number];
export const ruleTriggerSchema = z.enum(RULE_TRIGGERS);

// next-intl splits a t() key on "." for nested-message lookup, so a trigger value like
// "document.ingested" can never be used directly as a message key (found live in a browser
// check — it silently rendered the raw "rules.triggers.document.ingested" path instead of a
// translated label). messages/*/rules.json's `triggers` keys are the underscore form
// ("document_ingested") specifically so this lookup is the only place that has to know it. A
// literal record (not a `.replaceAll` function returning plain `string`) keeps the return type
// a narrow union next-intl's typed `t()` can actually check against messages/en/rules.json.
export const TRIGGER_MESSAGE_KEYS = {
  "document.ingested": "document_ingested",
  "document.updated": "document_updated",
  manual: "manual"
} as const satisfies Record<RuleTrigger, string>;

export function triggerMessageKey(trigger: RuleTrigger): (typeof TRIGGER_MESSAGE_KEYS)[RuleTrigger] {
  return TRIGGER_MESSAGE_KEYS[trigger];
}

// specs/07-rules-engine.md §Condition fields — document.custom.<key> is open-ended (rest match),
// everything else is fixed.
export const CONDITION_FIELDS = [
  "document.type",
  "document.title",
  "document.content",
  "document.date",
  "document.tags",
  "document.filename",
  "document.source"
] as const;

// specs/07-rules-engine.md §Operators.
export const CONDITION_OPERATORS = [
  "eq",
  "neq",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "regex",
  "in",
  "not_in",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "is_empty",
  "is_not_empty",
  "matches_date"
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

const conditionValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

// A leaf condition. `field` accepts document.custom.<key> alongside the fixed vocabulary above —
// validated as "one of CONDITION_FIELDS or a document.custom. prefix" rather than a bare string,
// so a typo'd field name is rejected at save time (specs/03-api.md: "Validates DSL against JSON
// schema before persisting"), not silently evaluated as always-empty at run time.
export const conditionLeafSchema = z.object({
  field: z.string().refine(
    (value) =>
      (CONDITION_FIELDS as readonly string[]).includes(value) ||
      value.startsWith("document.custom."),
    { message: "Unknown condition field" }
  ),
  op: z.enum(CONDITION_OPERATORS),
  value: z.union([conditionValueSchema, z.array(conditionValueSchema)]).optional()
});
export type ConditionLeaf = z.infer<typeof conditionLeafSchema>;

// Recursive all/any tree — z.lazy for the self-reference, matching the DSL in specs/07 §Rule DSL.
export type ConditionNode =
  | ConditionLeaf
  | { all: ConditionNode[] }
  | { any: ConditionNode[] };

export const conditionNodeSchema: z.ZodType<ConditionNode> = z.lazy(() =>
  z.union([
    conditionLeafSchema,
    z.object({ all: z.array(conditionNodeSchema).min(1) }),
    z.object({ any: z.array(conditionNodeSchema).min(1) })
  ])
);

// specs/07-rules-engine.md §Actions.
const setCustomFieldActionSchema = z.object({
  type: z.literal("set_custom_field"),
  key: z.string().trim().min(1),
  value: conditionValueSchema
});

// value: null clears the field (Paperless document_type is a single nullable FK, so "remove"
// means unset, not "remove one of several" the way remove_tag does) — added alongside the
// guided rule builder's "remove" operation for this attribute kind.
const setDocumentTypeActionSchema = z.object({
  type: z.literal("set_document_type"),
  value: z.string().trim().min(1).nullable()
});

const addRemoveTagActionSchema = z.object({
  type: z.enum(["add_tag", "remove_tag"]),
  value: z.string().trim().min(1)
});

const setStoragePathActionSchema = z.object({
  type: z.literal("set_storage_path"),
  value: z.string().trim().min(1)
});

const createReminderActionSchema = z.object({
  type: z.literal("create_reminder"),
  offset_days: z.number().int(),
  from_field: z.string().trim().min(1),
  assignee_role: z.enum(["owner", "admin", "member"]),
  message: z.string().trim().min(1).max(500)
});

const notifyActionSchema = z.object({
  type: z.literal("notify"),
  assignee_role: z.enum(["owner", "admin", "member"]),
  message: z.string().trim().min(1).max(500)
});

// ADR-0019 — files a document into an app-owned folder. No Paperless equivalent (unlike
// set_storage_path), so never added to PAPERLESS_NATIVE_ACTION_TYPES below.
const moveToFolderActionSchema = z.object({
  type: z.literal("move_to_folder"),
  folderId: z.string().uuid()
});

// specs/07: no run_script/http_request — the discriminated union itself is the enforcement that
// tenant-authored code execution can never be expressed, not a runtime check.
export const ruleActionSchema = z.discriminatedUnion("type", [
  setCustomFieldActionSchema,
  setDocumentTypeActionSchema,
  addRemoveTagActionSchema,
  setStoragePathActionSchema,
  createReminderActionSchema,
  notifyActionSchema,
  moveToFolderActionSchema
]);
export type RuleAction = z.infer<typeof ruleActionSchema>;

// Actions a Paperless workflow can express natively — used by rules.delegation.ts's decision
// procedure (specs/07 §What is ours vs. Paperless's).
export const PAPERLESS_NATIVE_ACTION_TYPES = new Set([
  "set_custom_field",
  "set_document_type",
  "add_tag",
  "remove_tag",
  "set_storage_path"
]);

export const createRuleSchema = z.object({
  name: z.string().trim().min(1).max(200),
  trigger: ruleTriggerSchema,
  priority: z.number().int().default(100),
  conditions: conditionNodeSchema,
  actions: z.array(ruleActionSchema).min(1)
});
export type CreateRuleInput = z.infer<typeof createRuleSchema>;

export const updateRuleSchema = createRuleSchema.partial().extend({
  enabled: z.boolean().optional()
});
export type UpdateRuleInput = z.infer<typeof updateRuleSchema>;

export const testRuleSchema = z.object({
  ruleId: z.string().uuid(),
  documentId: z.string().uuid()
});

export const startRuleBackfillSchema = z.object({
  ruleId: z.string().uuid(),
  filter: z
    .object({
      documentTypeKey: z.string().trim().min(1).optional(),
      dateFrom: z.string().trim().min(1).optional(),
      dateTo: z.string().trim().min(1).optional()
    })
    .default({})
});
