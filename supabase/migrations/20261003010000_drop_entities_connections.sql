-- Remove the entities & connections feature (specs/02-data-model.md, specs/05-level-1-structure.md).
-- Entities, entity types, and connections between documents/entities are deferred to a later
-- stage. `documents` never referenced these tables (connections were polymorphic, no FK), so
-- dropping is clean. This also removes the connection-specific rule actions, connection-based
-- listing filters/stats, and the `documentlink` custom-field type.

-- 1. Drop FK columns that reference the entity/connection tables first.
alter table public.saved_views
  drop constraint if exists saved_views_entity_type_id_fkey,
  drop column if exists entity_type_id;

alter table public.reminders
  drop constraint if exists reminders_entity_id_fkey,
  drop column if exists entity_id;

-- 2. Narrow saved_views.scope to documents-only. Any pre-existing entities-scoped saved view is
-- deleted first — its entity_type_id column is dropped above and its backing tables are dropped
-- below, so there is nothing left for it to reference (not a data-preserving case, unlike a
-- documents-scoped view).
delete from public.saved_views where scope <> 'documents';
alter table public.saved_views drop constraint if exists saved_views_scope_check;
alter table public.saved_views
  add constraint saved_views_scope_check check (scope in ('documents'));

-- 3. Narrow custom_field_defs.data_type to drop documentlink. Any pre-existing documentlink
-- field definition is deleted first — its values live in Paperless, not mirrored here, so this
-- only removes our local definition metadata, never Paperless data.
delete from public.custom_field_defs where data_type = 'documentlink';
alter table public.custom_field_defs drop constraint if exists custom_field_defs_data_type_check;
alter table public.custom_field_defs
  add constraint custom_field_defs_data_type_check
  check (data_type in ('string', 'integer', 'float', 'monetary', 'date', 'boolean', 'select', 'url'));

-- 4. Narrow rules.trigger to drop document.connected / entity.created. Any pre-existing rule on
-- one of these triggers is deleted (not disabled) — rule_runs/rule_backfills cascade on delete
-- (20260918000000_rules_engine.sql), so this leaves no orphaned run history, and a rule that can
-- never fire again has nothing worth keeping around disabled.
delete from public.rules where trigger in ('document.connected', 'entity.created');
alter table public.rules drop constraint if exists rules_trigger_check;
alter table public.rules
  add constraint rules_trigger_check
  check (trigger in ('document.ingested', 'document.updated', 'manual'));

-- 5. Rewrite apply_rule_action() without the connect/disconnect branch or source/target params.
-- The previous 13-arg version referenced the connections table, so it's dropped explicitly (a
-- create-or-replace with a different argument list would have left the old one behind).
drop function if exists public.apply_rule_action(
  uuid, uuid, uuid, text, jsonb, text, uuid, text, uuid, text, uuid, uuid, text
);

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
    'set_custom_field', 'set_document_type', 'add_tag', 'remove_tag', 'set_correspondent',
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

-- 6. Drop connection-only functions.
drop function if exists public.undo_rule_backfill(uuid, uuid);
drop function if exists public.merge_entities(uuid, uuid);
drop function if exists public.count_document_connections(uuid, uuid[]);
drop function if exists public.count_documents_without_connections(uuid, text, text, date, date, integer[]);
drop function if exists public.list_documents_without_connections(uuid, text, text, date, date, integer[], timestamptz, uuid, integer);
drop function if exists public.list_documents_without_connections_page(uuid, text, text, date, date, integer[], text, text, integer, integer);

-- 7. Rewrite dashboard counts RPCs to documents-only.
drop function if exists public.get_org_dashboard_counts(uuid);
create function public.get_org_dashboard_counts(p_organization_id uuid)
returns table(documents bigint)
language sql
stable
set search_path = public
as $$
  select count(*)::bigint
  from public.documents d
  where d.organization_id = p_organization_id and d.deleted_at is null;
$$;
grant execute on function public.get_org_dashboard_counts(uuid) to authenticated;

drop function if exists public.get_member_dashboard_counts(uuid, uuid);
create function public.get_member_dashboard_counts(p_organization_id uuid, p_user_id uuid)
returns table(documents bigint)
language sql
stable
set search_path = public
as $$
  select count(*)::bigint
  from public.documents d
  where d.organization_id = p_organization_id and d.deleted_at is null
    and d.created_by = p_user_id;
$$;
grant execute on function public.get_member_dashboard_counts(uuid, uuid) to authenticated;

-- 8. Drop the entity/connection tables. Connections is polymorphic (no FK into it), and
-- entity_identifiers references entities, so those drop first; entities references entity_types.
drop table if exists public.connections;
drop table if exists public.entity_identifiers;
drop table if exists public.entities;
drop table if exists public.entity_types;
