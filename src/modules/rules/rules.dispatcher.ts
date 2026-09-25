import { paperlessFor } from "@/lib/paperless/client";
import {
  createPaperlessDocumentType,
  createPaperlessTag,
  updatePaperlessDocument
} from "@/lib/paperless/documents";
import {
  getCachedDocumentTypes,
  getCachedTags,
  addCachedTag,
  addCachedDocumentType
} from "@/lib/paperless/metadata-cache";
import { UnprocessableError } from "@/lib/errors";
import type { ServiceContext } from "@/lib/service-context";
import { createNotification } from "@/modules/notifications/notifications.service";
import type { Database } from "@/types/database";

import type { SubjectContext } from "./rules.context";
import type { RuleAction } from "./rules.schemas";

type Rule = Database["public"]["Tables"]["rules"]["Row"];

export type ActionOutcome = {
  action: RuleAction;
  status: string;
};

// Fields a rule can write on a document — the vocabulary field_provenance and the in-run
// first-writer-wins map share (specs/07: "conflicts: first writer wins" + "user edits win over
// rules always").
function fieldKeyForAction(action: RuleAction): string | null {
  switch (action.type) {
    case "set_custom_field":
      return `document.custom.${action.key}`;
    case "set_document_type":
      return "document.type";
    case "set_storage_path":
      return "document.storage_path";
    case "move_to_folder":
      return "document.folder_id";
    default:
      return null; // add_tag/remove_tag are additive, not a single-value field — no conflict slot
  }
}

async function findOrCreateTagId(ctx: ServiceContext, name: string): Promise<number> {
  const client = await paperlessFor(ctx.orgId);
  const tags = await getCachedTags(client, ctx.orgId);
  const existing = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;

  const ownership = client.ownership;
  if (!ownership) throw new UnprocessableError("Tenant Paperless client has no ownership context");
  const created = await createPaperlessTag(client, name, ownership);
  await addCachedTag(ctx.orgId, created);
  return created.id;
}

// remove_tag must never create the tag it's trying to remove — a name that doesn't exist is
// already "removed" (no-op), not a reason to add it to the tenant's tag list first.
async function findExistingTagId(ctx: ServiceContext, name: string): Promise<number | null> {
  const client = await paperlessFor(ctx.orgId);
  const tags = await getCachedTags(client, ctx.orgId);
  return tags.find((t) => t.name.toLowerCase() === name.toLowerCase())?.id ?? null;
}

async function findOrCreateDocumentTypeId(ctx: ServiceContext, name: string): Promise<number> {
  const client = await paperlessFor(ctx.orgId);
  const types = await getCachedDocumentTypes(client, ctx.orgId);
  const existing = types.find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;

  const ownership = client.ownership;
  if (!ownership) throw new UnprocessableError("Tenant Paperless client has no ownership context");
  const created = await createPaperlessDocumentType(client, name, ownership);
  await addCachedDocumentType(ctx.orgId, created);
  return created.id;
}

// specs/07-rules-engine.md: "User edits win over rules always" — checked per field before a
// rule writes it. A field field_provenance has never seen is unclaimed (fine to write); one
// last written by 'rule'/'import'/'system' is fine to overwrite (rules already resolve their
// own field-conflict via the in-run claims map below); one last written by 'user' blocks every
// later rule write until a human or explicit override changes it again.
//
// One query per document per dispatchRuleActions() call, not one per field-writing action — a
// rule with three Paperless-side actions (or several matched rules in the same trigger fire)
// used to issue three separate field_provenance lookups for the same document.
async function fetchUserOwnedFieldKeys(ctx: ServiceContext, documentId: string): Promise<Set<string>> {
  const { data, error } = await ctx.db
    .from("field_provenance")
    .select("field_key")
    .eq("document_id", documentId)
    .eq("updated_by", "user");
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.field_key));
}

async function notifyRole(
  ctx: ServiceContext,
  role: "owner" | "admin" | "member",
  input: { type: string; title: string; message: string; metadata?: Record<string, unknown> }
): Promise<void> {
  const { data: members, error } = await ctx.db
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", ctx.orgId)
    .eq("role", role);
  if (error) throw error;

  await Promise.all(
    (members ?? []).map((m) =>
      createNotification(m.user_id, {
        type: input.type,
        title: input.title,
        message: input.message,
        metadata: input.metadata as never
      })
    )
  );
}

// Applies one matched rule's actions against one subject. `fieldClaims` is shared across every
// rule evaluated for the same document in the same trigger fire (built by the caller,
// worker/jobs/run-rule.ts, before any rule's actions run) — first writer wins, later claimants
// record skipped_conflict instead of overwriting (specs/07 §Evaluation).
export async function dispatchRuleActions(
  ctx: ServiceContext,
  rule: Rule,
  ruleRunId: string,
  subject: SubjectContext,
  fieldClaims: Map<string, string>
): Promise<ActionOutcome[]> {
  const outcomes: ActionOutcome[] = [];
  const userOwnedFieldKeys =
    subject.kind === "document" ? await fetchUserOwnedFieldKeys(ctx, subject.documentId) : new Set<string>();
  // Real bug found via live testing: two add_tag actions in the same rule (the guided builder's
  // new multi-tag row expands to one add_tag per tag) each independently recomputed "current
  // tags" from subject.fields — a snapshot taken once, before any action ran — so the second
  // add_tag's PATCH overwrote the first tag's addition instead of layering on top of it. This
  // holds the actually-current tag id list across every add_tag/remove_tag in one dispatch,
  // lazily seeded from the subject snapshot and updated after each write.
  const tagState: { ids: number[] | null } = { ids: null };

  for (const action of rule.actions as unknown as RuleAction[]) {
    outcomes.push(await dispatchOne(ctx, rule, ruleRunId, subject, fieldClaims, userOwnedFieldKeys, action, tagState));
  }

  return outcomes;
}

async function dispatchOne(
  ctx: ServiceContext,
  rule: Rule,
  ruleRunId: string,
  subject: SubjectContext,
  fieldClaims: Map<string, string>,
  userOwnedFieldKeys: Set<string>,
  action: RuleAction,
  tagState: { ids: number[] | null }
): Promise<ActionOutcome> {
  // ADR-0019: a plain documents.folder_id column write, never routed through paperlessFor() —
  // folders are app-owned, Paperless stays unaware of them. Kept separate from the combined
  // Paperless-actions block below rather than added to it, since every action there ends in a
  // paperlessFor(ctx.orgId) call this one must never make.
  if (action.type === "move_to_folder") {
    if (subject.kind !== "document") return { action, status: "skipped_not_a_document" };

    const fieldKey = fieldKeyForAction(action);
    if (fieldKey) {
      const claimedBy = fieldClaims.get(fieldKey);
      if (claimedBy && claimedBy !== rule.id) return { action, status: `skipped_conflict:${claimedBy}` };
      if (userOwnedFieldKeys.has(fieldKey)) return { action, status: "skipped_conflict:user" };
      fieldClaims.set(fieldKey, rule.id);
    }

    const { data: folder, error: folderError } = await ctx.db
      .from("folders")
      .select("id")
      .eq("id", action.folderId)
      .eq("organization_id", ctx.orgId)
      .is("deleted_at", null)
      .maybeSingle();
    if (folderError) throw folderError;
    if (!folder) return { action, status: "skipped_folder_not_found" };

    const { error: updateError } = await ctx.db
      .from("documents")
      .update({ folder_id: action.folderId })
      .eq("id", subject.documentId)
      .eq("organization_id", ctx.orgId);
    if (updateError) throw updateError;

    const { data: status, error } = await ctx.db.rpc("apply_rule_action", {
      p_organization_id: ctx.orgId,
      p_rule_id: rule.id,
      p_rule_run_id: ruleRunId,
      p_action_type: action.type,
      p_action: action as never,
      p_document_id: subject.documentId,
      p_field_key: fieldKey
    });
    if (error) throw error;
    return { action, status: status as string };
  }

  if (
    action.type === "set_custom_field" ||
    action.type === "set_document_type" ||
    action.type === "add_tag" ||
    action.type === "remove_tag" ||
    action.type === "set_storage_path"
  ) {
    if (subject.kind !== "document") return { action, status: "skipped_not_a_document" };

    const fieldKey = fieldKeyForAction(action);
    if (fieldKey) {
      const claimedBy = fieldClaims.get(fieldKey);
      if (claimedBy && claimedBy !== rule.id) {
        return { action, status: `skipped_conflict:${claimedBy}` };
      }
      if (userOwnedFieldKeys.has(fieldKey)) {
        return { action, status: "skipped_conflict:user" };
      }
      fieldClaims.set(fieldKey, rule.id);
    }

    const client = await paperlessFor(ctx.orgId);

    if (action.type === "set_custom_field") {
      const def = subject.customFieldDefs.find((d) => d.key === action.key);
      if (!def?.paperless_custom_field_id) return { action, status: "skipped_unknown_field" };
      await updatePaperlessDocument(client, subject.paperlessDocumentId, {
        custom_fields: [{ field: def.paperless_custom_field_id, value: action.value }]
      });
    } else if (action.type === "set_document_type") {
      // value: null is the guided builder's "remove document type" operation — Paperless's
      // document_type is a single nullable FK, so removing means unsetting it, not finding an
      // object to remove.
      const id = action.value === null ? null : await findOrCreateDocumentTypeId(ctx, action.value);
      await updatePaperlessDocument(client, subject.paperlessDocumentId, { document_type: id });
    } else if (action.type === "add_tag" || action.type === "remove_tag") {
      const id = action.type === "add_tag" ? await findOrCreateTagId(ctx, action.value) : await findExistingTagId(ctx, action.value);
      if (id === null) return { action, status: "noop_tag_not_found" };

      if (tagState.ids === null) {
        const currentTags = subject.fields["document.tags"];
        const allTags = await getCachedTags(client, ctx.orgId);
        const idByName = new Map(allTags.map((t) => [t.name, t.id]));
        tagState.ids = currentTags.map((name) => idByName.get(name)).filter((v): v is number => v !== undefined);
      }
      const nextIds =
        action.type === "add_tag"
          ? [...new Set([...tagState.ids, id])]
          : tagState.ids.filter((tagId) => tagId !== id);
      await updatePaperlessDocument(client, subject.paperlessDocumentId, { tags: nextIds });
      tagState.ids = nextIds;
    } else {
      // set_storage_path: no createOwnedObject wrapper exists for storage paths yet — recorded
      // as a known gap rather than silently guessed at, since specs/07 lists it as an action but
      // no caller in this codebase creates storage paths by name today.
      return { action, status: "skipped_not_implemented" };
    }

    const { data: status, error } = await ctx.db.rpc("apply_rule_action", {
      p_organization_id: ctx.orgId,
      p_rule_id: rule.id,
      p_rule_run_id: ruleRunId,
      p_action_type: action.type,
      p_action: action as never,
      p_document_id: subject.documentId,
      p_field_key: fieldKey
    });
    if (error) throw error;
    return { action, status: status as string };
  }

  if (action.type === "create_reminder") {
    if (subject.kind !== "document") return { action, status: "skipped_not_a_document" };
    const fromValue = (subject.fields as Record<string, unknown>)[action.from_field] ?? subject.custom[action.from_field];
    if (typeof fromValue !== "string") return { action, status: "skipped_missing_from_field" };

    const baseDate = new Date(fromValue);
    if (Number.isNaN(baseDate.getTime())) return { action, status: "skipped_invalid_date" };
    baseDate.setDate(baseDate.getDate() + action.offset_days);

    const { error } = await ctx.db.from("reminders").insert({
      organization_id: ctx.orgId,
      document_id: subject.documentId,
      due_date: baseDate.toISOString().slice(0, 10),
      assignee_role: action.assignee_role,
      message: action.message,
      rule_id: rule.id
    });
    if (error) throw error;
    return recordRuleActionOutcome(ctx, rule, ruleRunId, action, "create_reminder", subject);
  }

  if (action.type === "notify") {
    await notifyRole(ctx, action.assignee_role, {
      type: "rule.notify",
      title: rule.name,
      message: action.message,
      metadata: { ruleId: rule.id, documentId: subject.kind === "document" ? subject.documentId : null }
    });
    return recordRuleActionOutcome(ctx, rule, ruleRunId, action, "notify", subject);
  }

  return { action, status: "skipped_unknown_action" };
}

// create_reminder/notify's domain write (a reminders insert / a notifications insert) is
// already done above by the time this runs — apply_rule_action()'s own catch-all branch exists
// exactly for this ("assign_responsible / create_reminder / notify: domain write already
// performed by the caller... this call only records the run outcome and audit event uniformly"),
// but the dispatcher never actually called it for these two action types, found via live
// testing: a real notify action fired and the notification was genuinely created, yet
// rule_runs.actions_applied stayed empty and no audit_logs "rule.applied" row was ever written —
// the run looked like nothing happened even though it had.
async function recordRuleActionOutcome(
  ctx: ServiceContext,
  rule: Rule,
  ruleRunId: string,
  action: RuleAction,
  actionType: string,
  subject: SubjectContext
): Promise<ActionOutcome> {
  const { data: status, error } = await ctx.db.rpc("apply_rule_action", {
    p_organization_id: ctx.orgId,
    p_rule_id: rule.id,
    p_rule_run_id: ruleRunId,
    p_action_type: actionType,
    p_action: action as never,
    p_document_id: subject.kind === "document" ? subject.documentId : null
  });
  if (error) throw error;
  return { action, status: status as string };
}
