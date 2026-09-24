-- ADR-0019: move_to_folder is dispatched by rules.dispatcher.ts, which performs the
-- documents.folder_id write itself (a plain column update, never routed through Paperless) before
-- calling apply_rule_action() — this function's job for it, like every other single-value field
-- action, is only field_provenance bookkeeping + the audit_logs row, matching
-- set_custom_field/set_document_type/etc.
create or replace function public.apply_rule_action(
  p_organization_id uuid,
  p_rule_id uuid,
  p_rule_run_id uuid,
  p_action_type text,
  p_action jsonb,
  p_source_kind text default null,
  p_source_id uuid default null,
  p_target_kind text default null,
  p_target_id uuid default null,
  p_relation text default null,
  p_rule_backfill_id uuid default null,
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
  v_connection_id uuid;
begin
  if not exists (select 1 from public.rules where id = p_rule_id and organization_id = p_organization_id) then
    raise exception 'Rule not found';
  end if;

  if p_action_type in ('connect_entity', 'disconnect_entity') then
    if p_source_kind = 'document' then
      if not exists (select 1 from public.documents where id = p_source_id and organization_id = p_organization_id) then
        raise exception 'Source document not found';
      end if;
    else
      if not exists (select 1 from public.entities where id = p_source_id and organization_id = p_organization_id) then
        raise exception 'Source entity not found';
      end if;
    end if;

    if p_target_kind = 'document' then
      if not exists (select 1 from public.documents where id = p_target_id and organization_id = p_organization_id) then
        raise exception 'Target document not found';
      end if;
    else
      if not exists (select 1 from public.entities where id = p_target_id and organization_id = p_organization_id) then
        raise exception 'Target entity not found';
      end if;
    end if;
  end if;

  if p_action_type = 'connect_entity' then
    select id into v_connection_id
    from public.connections
    where organization_id = p_organization_id
      and deleted_at is null
      and least(source_id, target_id) = least(p_source_id, p_target_id)
      and greatest(source_id, target_id) = greatest(p_source_id, p_target_id)
      and relation = p_relation;

    if v_connection_id is null then
      insert into public.connections (
        organization_id, source_kind, source_id, target_kind, target_id, relation,
        created_via, rule_id, rule_backfill_id
      ) values (
        p_organization_id, p_source_kind, p_source_id, p_target_kind, p_target_id, p_relation,
        'rule', p_rule_id, p_rule_backfill_id
      )
      returning id into v_connection_id;
      v_status := 'applied';
    else
      v_status := 'noop_already_connected';
    end if;

  elsif p_action_type = 'disconnect_entity' then
    update public.connections
    set deleted_at = now()
    where organization_id = p_organization_id
      and deleted_at is null
      and least(source_id, target_id) = least(p_source_id, p_target_id)
      and greatest(source_id, target_id) = greatest(p_source_id, p_target_id)
      and relation = p_relation
    returning id into v_connection_id;

    v_status := case when v_connection_id is null then 'noop_not_connected' else 'applied' end;

  elsif p_action_type in (
    'set_custom_field', 'set_document_type', 'add_tag', 'remove_tag', 'set_correspondent',
    'set_storage_path', 'move_to_folder'
  ) then
    -- add_tag/remove_tag pass a null field key by design (fieldKeyForAction()) — nothing to
    -- attribute provenance to for an additive/removable multi-value field, so skip the write
    -- rather than violate field_provenance's not-null constraint on field_key.
    if p_field_key is not null then
      insert into public.field_provenance (organization_id, document_id, field_key, updated_by, source_id, updated_at)
      values (p_organization_id, p_document_id, p_field_key, 'rule', p_rule_id, now())
      on conflict (document_id, field_key)
      do update set updated_by = 'rule', source_id = p_rule_id, updated_at = now();
    end if;
    v_status := 'applied';

  else
    v_status := 'applied';
  end if;

  if p_rule_run_id is not null then
    update public.rule_runs
    set actions_applied = actions_applied || jsonb_build_array(
      jsonb_build_object('action', p_action, 'status', v_status, 'connection_id', v_connection_id)
    )
    where id = p_rule_run_id and organization_id = p_organization_id;
  end if;

  insert into public.audit_logs (actor_type, organization_id, action, entity_type, entity_id, metadata)
  values (
    'rule', p_organization_id, 'rule.applied', 'rule', p_rule_id::text,
    jsonb_build_object('action_type', p_action_type, 'status', v_status, 'rule_run_id', p_rule_run_id,
      'document_id', p_document_id, 'connection_id', v_connection_id)
  );

  return v_status;
end;
$$;
