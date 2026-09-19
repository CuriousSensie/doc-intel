// specs/02-data-model.md §Custom fields, docs/spike-findings.md §1 #6. This module — and ONLY
// this module — is where custom field *definitions* are ever read for the tenant-facing app.
// Paperless's own GET /api/custom_fields/ leaks definitions across tenants even with correct
// owner/set_permissions (confirmed against the live pinned instance during the Phase 0
// isolation spike). Every caller (UI, Server Actions, worker jobs) must go through
// listCustomFieldDefs()/getCustomFieldDef() below — never call Paperless's raw endpoint for
// definitions from anywhere else in the codebase.
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { logEvent } from "@/lib/events";
import type { ServiceContext } from "@/lib/service-context";
import type { Database } from "@/types/database";

export type CustomFieldDef = Database["public"]["Tables"]["custom_field_defs"]["Row"];
export type CustomFieldDataType = CustomFieldDef["data_type"];
// A select field's options are Paperless-generated {id, label} pairs, not bare strings — a
// document's value for the field must reference the Paperless-assigned `id`, never the label
// (confirmed live: Paperless rejects a label passed as a value). `id` is optional here since a
// caller minting a brand-new option (not yet round-tripped through Paperless) won't have one
// yet — Paperless assigns it, and by the time a def is persisted every option has one.
export type CustomFieldSelectOption = { id?: string; label: string };

const UNIQUE_VIOLATION = "23505";

// specs/02-data-model.md's decision table: "a link to a business entity (customer, project) —
// Documenti connections — never a Paperless field." `documentlink` is the data type that
// represents exactly this, so it can never be backed by a real Paperless custom field —
// specs/12-agent-rules.md rule 6, the single most likely wrong turn in this build. This is a
// runtime assertion, not just a comment: violating it is rejected, not merely discouraged.
function assertDocumentLinkNeverBacksAPaperlessField(
  dataType: CustomFieldDataType,
  paperlessCustomFieldId: number | null | undefined
): void {
  if (dataType === "documentlink" && paperlessCustomFieldId != null) {
    throw new ValidationError(
      "A documentlink field represents a connection to a business entity and can never be " +
        "backed by a Paperless custom field — create a connection instead (specs/12-agent-rules.md rule 6)"
    );
  }
}

async function fetchCustomFieldDef(ctx: ServiceContext, id: string): Promise<CustomFieldDef> {
  const { data, error } = await ctx.db
    .from("custom_field_defs")
    .select("*")
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NotFoundError("Custom field definition not found");
  return data;
}

export async function listCustomFieldDefs(ctx: ServiceContext): Promise<CustomFieldDef[]> {
  const { data, error } = await ctx.db
    .from("custom_field_defs")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .order("label", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getCustomFieldDef(ctx: ServiceContext, id: string): Promise<CustomFieldDef> {
  return fetchCustomFieldDef(ctx, id);
}

export async function createCustomFieldDef(
  ctx: ServiceContext,
  input: {
    key: string;
    label: string;
    dataType: CustomFieldDataType;
    options?: CustomFieldSelectOption[];
    appliesTo?: string[];
    paperlessCustomFieldId?: number | null;
    isRequired?: boolean;
  }
): Promise<CustomFieldDef> {
  assertDocumentLinkNeverBacksAPaperlessField(input.dataType, input.paperlessCustomFieldId);

  const { data, error } = await ctx.db
    .from("custom_field_defs")
    .insert({
      organization_id: ctx.orgId,
      key: input.key,
      label: input.label,
      data_type: input.dataType,
      options: input.options ?? null,
      applies_to: input.appliesTo ?? [],
      paperless_custom_field_id: input.paperlessCustomFieldId ?? null,
      is_required: input.isRequired ?? false
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new ConflictError(`A custom field with key "${input.key}" already exists`);
    }
    throw error;
  }

  await logEvent({
    actorId: ctx.actorId,
    action: "custom_field_def.created",
    entityType: "custom_field_def",
    entityId: data.id,
    organizationId: ctx.orgId,
    metadata: { key: input.key, data_type: input.dataType }
  });

  return data;
}

// key and data_type are immutable once created (a type change here would silently reinterpret
// every document's already-stored value — unlike an entity_type field, there's no lossless-
// change carve-out for custom fields). label/options/applies_to/is_required only.
export async function updateCustomFieldDef(
  ctx: ServiceContext,
  id: string,
  input: {
    label?: string;
    options?: CustomFieldSelectOption[];
    appliesTo?: string[];
    isRequired?: boolean;
  }
): Promise<CustomFieldDef> {
  await fetchCustomFieldDef(ctx, id);

  const { data, error } = await ctx.db
    .from("custom_field_defs")
    .update({
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.options !== undefined ? { options: input.options } : {}),
      ...(input.appliesTo !== undefined ? { applies_to: input.appliesTo } : {}),
      ...(input.isRequired !== undefined ? { is_required: input.isRequired } : {})
    })
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function deleteCustomFieldDef(ctx: ServiceContext, id: string): Promise<void> {
  await fetchCustomFieldDef(ctx, id);

  const { error } = await ctx.db
    .from("custom_field_defs")
    .delete()
    .eq("id", id)
    .eq("organization_id", ctx.orgId);

  if (error) throw error;

  await logEvent({
    actorId: ctx.actorId,
    action: "custom_field_def.deleted",
    entityType: "custom_field_def",
    entityId: id,
    organizationId: ctx.orgId
  });
}
