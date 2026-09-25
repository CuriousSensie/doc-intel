-- Remove the correspondents feature (Paperless-ngx concept).
-- Correspondents are a Paperless-ngx concept that we synced into our DB as a mirror column.
-- This migration drops the mirror column and removes all correspondent-related functionality.

-- 1. Drop the correspondent_name column from documents table
alter table public.documents drop column if exists correspondent_name;

-- 2. Remove 'correspondent' (and the never-written 'workflow'/'saved_view' — app code only ever
-- inserts 'document'/'document_type'/'storage_path', confirmed via sync-paperless-document.ts
-- and provision-tenant.ts) from paperless_object_map.object_type. Delete any pre-existing rows
-- using a value about to be dropped first — narrowing a CHECK constraint fails if any row would
-- violate it (see the saved_views.scope narrowing above for the same pattern).
-- Note: This is a CHECK constraint, so we need to drop and recreate it
delete from public.paperless_object_map where object_type in ('correspondent', 'workflow', 'saved_view');
alter table public.paperless_object_map drop constraint if exists paperless_object_map_object_type_check;
alter table public.paperless_object_map
  add constraint paperless_object_map_object_type_check
  check (object_type in ('document', 'tag', 'document_type', 'custom_field', 'storage_path'));

-- 3. field_provenance.field_key never had a CHECK constraint (20260918000000_rules_engine.sql:
-- `field_key text not null`, open vocabulary) — custom-field writes use a dynamic
-- `document.custom.<key>` per field (documents.service.ts, rules.dispatcher.ts), not the literal
-- string 'document.custom'. A fixed-enum constraint listing 'document.custom' verbatim would
-- reject every real custom-field provenance write going forward, not just historical
-- 'document.correspondent' rows — so the pattern below allows the whole document.custom.*
-- family instead of a single literal. Existing document.correspondent rows are deleted first
-- since that field no longer exists to attribute provenance to.
delete from public.field_provenance where field_key = 'document.correspondent';
alter table public.field_provenance drop constraint if exists field_provenance_field_key_check;
alter table public.field_provenance
  add constraint field_provenance_field_key_check
  check (
    field_key in ('document.type', 'document.tags', 'document.storage_path', 'document.folder_id')
    or field_key like 'document.custom.%'
  );

-- 4. Rewrite apply_rule_action() to remove set_correspondent branch
-- Drop the old function first
drop function if exists public.apply_rule_action(
  uuid, uuid, uuid, text, jsonb, uuid, text
);

-- Recreate without set_correspondent
create or replace function public.apply_rule_action(
  p_organization_id uuid,
  p_rule_id uuid,
  p_rule_run_id uuid,
  p_action_type text,
  p_action jsonb,
  p_document_id uuid default null,
  p_field_key text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := 'applied';
begin
  if not exists (select 1 from public.rules where id = p_rule_id and organization_id = p_organization_id) then
    raise exception 'Rule not found';
  end if;

  if p_action_type in (
    'set_custom_field', 'set_document_type', 'add_tag', 'remove_tag',
    'set_storage_path', 'move_to_folder'
  ) then
    -- add_tag/remove_tag pass a null field key by design — nothing to attribute provenance to
    -- for an additive/removable multi-value field, so skip the write rather than violate
    -- field_provenance's not-null constraint on field_key.
    if p_field_key is not null then
      insert into public.field_provenance (organization_id, document_id, field_key, updated_by, source_id, updated_at)
      values (p_organization_id, p_document_id, p_field_key, 'rule', p_rule_id, now())
      on conflict (document_id, field_key)
      do update set updated_by = 'rule', source_id = p_rule_id, updated_at = now();
    end if;
    v_status := 'applied';

  else
    -- create_reminder / notify: domain write already performed by the caller — this call only
    -- records the run outcome and audit event uniformly.
    v_status := 'applied';
  end if;

  if p_rule_run_id is not null then
    update public.rule_runs
    set actions_applied = actions_applied || jsonb_build_array(
      jsonb_build_object('action', p_action, 'status', v_status)
    )
    where id = p_rule_run_id and organization_id = p_organization_id;
  end if;

  insert into public.audit_logs (actor_type, organization_id, action, entity_type, entity_id, metadata)
  values (
    'rule', p_organization_id, 'rule.applied', 'rule', p_rule_id::text,
    jsonb_build_object('action_type', p_action_type, 'status', v_status, 'rule_run_id', p_rule_run_id,
      'document_id', p_document_id)
  );

  return v_status;
end;
$$;

revoke all on function public.apply_rule_action(uuid, uuid, uuid, text, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.apply_rule_action(uuid, uuid, uuid, text, jsonb, uuid, text) to service_role;
