import { paperlessFor } from "@/lib/paperless/client";
import {
  createPaperlessCorrespondent,
  createPaperlessDocumentType,
  createPaperlessTag,
  updatePaperlessDocument
} from "@/lib/paperless/documents";
import {
  getCachedCorrespondents,
  getCachedDocumentTypes,
  getCachedTags,
  addCachedTag,
  addCachedCorrespondent,
  addCachedDocumentType
} from "@/lib/paperless/metadata-cache";
import { UnprocessableError } from "@/lib/errors";
import type { ServiceContext } from "@/lib/service-context";
import { normalizeIdentifier } from "@/modules/entities/identifier-normalization";
import { createNotification } from "@/modules/notifications/notifications.service";
import type { Database } from "@/types/database";

import type { SubjectContext } from "./rules.context";
import type { ConnectEntityRef, RuleAction } from "./rules.schemas";

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
    case "set_correspondent":
      return "document.correspondent";
    case "set_storage_path":
      return "document.storage_path";
    default:
      return null; // add_tag/remove_tag are additive, not a single-value field — no conflict slot
  }
}

// specs/10-nonfunctional.md isolation test #10: "A's rule references B's entity" must be a
// validation failure, not a cross-tenant connection. entity_ref by "identifier"/"name" are
// already scoped by ctx.orgId in their own queries below; by "id" is the one shape that takes a
// raw entity id directly from the rule's own stored actions jsonb — a rule authored (or, more
// realistically, restored/migrated/copy-pasted) with another tenant's entity id in it must not
// silently resolve. Same ownership check connections.service.ts#assertBelongsToOrg() already
// does for a client-supplied connection target.
async function resolveEntityRef(ctx: ServiceContext, ref: ConnectEntityRef): Promise<string | null> {
  if (ref.by === "id") {
    const { data, error } = await ctx.db
      .from("entities")
      .select("id")
      .eq("id", ref.entityId)
      .eq("organization_id", ctx.orgId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    return data?.id ?? null;
  }

  if (ref.by === "identifier") {
    const normalized = normalizeIdentifier(ref.kind, ref.value);
    const { data, error } = await ctx.db
      .from("entity_identifiers")
      .select("entity_id")
      .eq("organization_id", ctx.orgId)
      .eq("kind", ref.kind)
      .eq("normalized", normalized)
      .maybeSingle();
    if (error) throw error;
    return data?.entity_id ?? null;
  }

  // by: "name"
  const { data: entityType, error: typeError } = await ctx.db
    .from("entity_types")
    .select("id")
    .eq("organization_id", ctx.orgId)
    .eq("key", ref.entityTypeKey)
    .maybeSingle();
  if (typeError) throw typeError;
  if (!entityType) return null;

  const { data, error } = await ctx.db
    .from("entities")
    .select("id")
    .eq("organization_id", ctx.orgId)
    .eq("entity_type_id", entityType.id)
    .eq("display_name", ref.name)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
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

async function findOrCreateCorrespondentId(ctx: ServiceContext, name: string): Promise<number> {
  const client = await paperlessFor(ctx.orgId);
  const correspondents = await getCachedCorrespondents(client, ctx.orgId);
  const existing = correspondents.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;

  const ownership = client.ownership;
  if (!ownership) throw new UnprocessableError("Tenant Paperless client has no ownership context");
  const created = await createPaperlessCorrespondent(client, name, ownership);
  await addCachedCorrespondent(ctx.orgId, created);
  return created.id;
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
  fieldClaims: Map<string, string>,
  options: { ruleBackfillId?: string | null } = {}
): Promise<ActionOutcome[]> {
  const outcomes: ActionOutcome[] = [];
  const userOwnedFieldKeys =
    subject.kind === "document" ? await fetchUserOwnedFieldKeys(ctx, subject.documentId) : new Set<string>();

  for (const action of rule.actions as unknown as RuleAction[]) {
    outcomes.push(await dispatchOne(ctx, rule, ruleRunId, subject, fieldClaims, userOwnedFieldKeys, action, options));
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
  options: { ruleBackfillId?: string | null }
): Promise<ActionOutcome> {
  if (action.type === "connect_entity" || action.type === "disconnect_entity" || action.type === "assign_responsible") {
    const ref = action.entity_ref;
    const targetId = await resolveEntityRef(ctx, ref);
    if (!targetId) return { action, status: "skipped_entity_not_found" };

    const sourceKind = subject.kind;
    const sourceId = subject.kind === "document" ? subject.documentId : subject.entityId;
    const relation = action.type === "assign_responsible" ? "assigned_to" : action.relation;
    const actionType = action.type === "disconnect_entity" ? "disconnect_entity" : "connect_entity";

    const { data: status, error } = await ctx.db.rpc("apply_rule_action", {
      p_organization_id: ctx.orgId,
      p_rule_id: rule.id,
      p_rule_run_id: ruleRunId,
      p_action_type: actionType,
      p_action: action as never,
      p_source_kind: sourceKind,
      p_source_id: sourceId,
      p_target_kind: "entity",
      p_target_id: targetId,
      p_relation: relation,
      p_rule_backfill_id: options.ruleBackfillId ?? null
    });
    if (error) throw error;
    return { action, status: status as string };
  }

  if (
    action.type === "set_custom_field" ||
    action.type === "set_document_type" ||
    action.type === "add_tag" ||
    action.type === "remove_tag" ||
    action.type === "set_correspondent" ||
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
      const id = await findOrCreateDocumentTypeId(ctx, action.value);
      await updatePaperlessDocument(client, subject.paperlessDocumentId, { document_type: id });
    } else if (action.type === "set_correspondent") {
      const id = await findOrCreateCorrespondentId(ctx, action.value);
      await updatePaperlessDocument(client, subject.paperlessDocumentId, { correspondent: id });
    } else if (action.type === "add_tag" || action.type === "remove_tag") {
      const id = action.type === "add_tag" ? await findOrCreateTagId(ctx, action.value) : await findExistingTagId(ctx, action.value);
      if (id === null) return { action, status: "noop_tag_not_found" };

      const currentTags = subject.fields["document.tags"];
      const allTags = await getCachedTags(client, ctx.orgId);
      const idByName = new Map(allTags.map((t) => [t.name, t.id]));
      const currentIds = currentTags.map((name) => idByName.get(name)).filter((v): v is number => v !== undefined);
      const nextIds =
        action.type === "add_tag"
          ? [...new Set([...currentIds, id])]
          : currentIds.filter((tagId) => tagId !== id);
      await updatePaperlessDocument(client, subject.paperlessDocumentId, { tags: nextIds });
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
    return { action, status: "applied" };
  }

  if (action.type === "notify") {
    await notifyRole(ctx, action.assignee_role, {
      type: "rule.notify",
      title: rule.name,
      message: action.message,
      metadata: { ruleId: rule.id, documentId: subject.kind === "document" ? subject.documentId : null }
    });
    return { action, status: "applied" };
  }

  return { action, status: "skipped_unknown_action" };
}
