-- Phase 4 (specs/07-rules-engine.md): rules, rule_runs, rule_backfills, field_provenance,
-- reminders, and apply_rule_action() (docs/adr/0008 — the audit write for rule.applied is
-- atomic with the domain mutation). connections.rule_id already exists
-- (20260914000000_entities_connections_fields_views.sql) but was unused until now;
-- rule_backfill_id is added here per docs/adr/0010 — undo must scope to one backfill run, never
-- a bare rule_id, since ongoing-trigger connections and backfill connections share rule_id.

create table public.rules (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (length(btrim(name)) > 0),
  enabled         boolean not null default true,
  trigger         text not null check (trigger in (
                    'document.ingested', 'document.updated', 'document.connected',
                    'entity.created', 'manual'
                  )),
  priority        integer not null default 100,
  conditions      jsonb not null,
  actions         jsonb not null,
  delegate_to_paperless boolean not null default false,
  paperless_workflow_id integer,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- Evaluation order the spec requires: enabled rules for org+trigger, priority asc, id asc.
create index rules_organization_trigger_priority_idx
  on public.rules (organization_id, trigger, priority, id)
  where enabled and deleted_at is null;

create trigger rules_set_updated_at before update on public.rules
  for each row execute function public.set_updated_at();

alter table public.rules enable row level security;

create policy "rules_select_member" on public.rules
  for select using (public.is_organization_member(organization_id) or public.is_app_admin());

create policy "rules_write_member" on public.rules
  for all using (public.has_organization_write_access(organization_id) or public.is_app_admin())
  with check (public.has_organization_write_access(organization_id) or public.is_app_admin());

-- Queryable per rule and per document (specs/07 §Visibility item 1).
create table public.rule_runs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_id         uuid not null references public.rules(id) on delete cascade,
  document_id     uuid references public.documents(id) on delete cascade,
  trigger         text not null,
  matched         boolean not null,
  conditions_trace jsonb not null default '[]'::jsonb,
  actions_applied jsonb not null default '[]'::jsonb,
  status          text not null default 'ok'
                  check (status in ('ok', 'skipped_conflict', 'failed', 'timeout')),
  error_message   text,
  cascade_depth   integer not null default 0,
  created_at      timestamptz not null default now()
);

create index rule_runs_organization_rule_created_idx
  on public.rule_runs (organization_id, rule_id, created_at desc);
create index rule_runs_organization_document_created_idx
  on public.rule_runs (organization_id, document_id, created_at desc)
  where document_id is not null;

alter table public.rule_runs enable row level security;

create policy "rule_runs_select_member" on public.rule_runs
  for select using (public.is_organization_member(organization_id) or public.is_app_admin());
-- No insert/update policy: rule_runs is written only by apply_rule_action()/worker (service role).

-- One row per backfill invocation of a rule (docs/adr/0010) — the undo scope.
create table public.rule_backfills (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_id         uuid not null references public.rules(id) on delete cascade,
  status          text not null default 'pending'
                  check (status in ('pending', 'running', 'paused', 'cancelled', 'completed', 'failed')),
  filter          jsonb not null default '{}'::jsonb,
  matched_count   integer not null default 0,
  applied_count   integer not null default 0,
  -- Cursor pagination over the filtered document set (documents.id order) — there is no
  -- per-row backfill table the way import_rows tracks per-row state, since a "row" here is
  -- just "this document was considered," which advancing the cursor already captures; a
  -- document a rule doesn't match or whose action target can't be resolved still needs to
  -- count as considered so the chunk loop terminates instead of reprocessing it forever.
  cursor_document_id uuid,
  created_by      uuid references auth.users(id) on delete set null,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (id, organization_id)
);

create index rule_backfills_organization_rule_idx
  on public.rule_backfills (organization_id, rule_id, created_at desc);

alter table public.rule_backfills enable row level security;

create policy "rule_backfills_select_member" on public.rule_backfills
  for select using (public.is_organization_member(organization_id) or public.is_app_admin());
create policy "rule_backfills_insert_member" on public.rule_backfills
  for insert with check (
    created_by = (select auth.uid())
    and status = 'pending'
    and public.has_organization_write_access(organization_id)
  );
-- Status/counters are worker-managed from here; no update policy for authenticated users.

alter table public.connections
  add column rule_backfill_id uuid references public.rule_backfills(id) on delete set null;

create index connections_rule_backfill_idx on public.connections (rule_backfill_id)
  where rule_backfill_id is not null;

-- Tracks the last writer of each (document, field) pair so a later rule run can tell whether a
-- human edited the field since the rule last wrote it (specs/07: "user edits win over rules
-- always"). field_key is our own vocabulary (document.custom.<key>, document.type, document.tags,
-- document.correspondent, document.storage_path) — reused unmodified by Level 2 for AI
-- provenance display (specs/08-level-2-ai.md).
create table public.field_provenance (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id     uuid not null references public.documents(id) on delete cascade,
  field_key       text not null,
  updated_by      text not null check (updated_by in ('user', 'rule', 'import', 'ai', 'system')),
  source_id       uuid,
  updated_at      timestamptz not null default now(),
  primary key (document_id, field_key)
);

create index field_provenance_organization_idx on public.field_provenance (organization_id);

alter table public.field_provenance enable row level security;

create policy "field_provenance_select_member" on public.field_provenance
  for select using (public.is_organization_member(organization_id) or public.is_app_admin());
-- rls-coverage: admin-only (no write policy) — written only via apply_rule_action()/service role.

create table public.reminders (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id     uuid references public.documents(id) on delete cascade,
  entity_id       uuid references public.entities(id) on delete cascade,
  due_date        date not null,
  assignee_role   text not null check (assignee_role in ('owner', 'admin', 'member')),
  message         text not null,
  rule_id         uuid references public.rules(id) on delete set null,
  fired_at        timestamptz,
  created_at      timestamptz not null default now()
);

create index reminders_due_idx on public.reminders (due_date) where fired_at is null;
create index reminders_organization_idx on public.reminders (organization_id);

alter table public.reminders enable row level security;

create policy "reminders_select_member" on public.reminders
  for select using (public.is_organization_member(organization_id) or public.is_app_admin());
-- rls-coverage: admin-only (no write policy) — written only by rule actions / worker sweep.

-- Atomic mutation + rule_runs update + audit_logs insert (docs/adr/0008, named in the ADR
-- itself). p_mutation is a pre-validated instruction the caller (rules.dispatcher.ts) has
-- already resolved — this function does not interpret rule DSL, it only performs the connection
-- insert/delete idempotently and records the outcome. Paperless-side field writes happen before
-- this call (the write-through itself isn't transactional with Postgres); this function still
-- records field_provenance for them so the "record in rule_run.actions_applied" and
-- "audit_events as rule.applied" requirements hold for every action type, not only connections.
create function public.apply_rule_action(
  p_organization_id uuid,
  p_rule_id uuid,
  p_rule_run_id uuid,
  p_action_type text,
  p_action jsonb,
  -- connect_entity / disconnect_entity
  p_source_kind text default null,
  p_source_id uuid default null,
  p_target_kind text default null,
  p_target_id uuid default null,
  p_relation text default null,
  p_rule_backfill_id uuid default null,
  -- field writes (already applied to Paperless by the caller before this call)
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
    'set_storage_path'
  ) then
    -- Already written through to Paperless by the caller; this call's job is provenance + audit.
    insert into public.field_provenance (organization_id, document_id, field_key, updated_by, source_id, updated_at)
    values (p_organization_id, p_document_id, p_field_key, 'rule', p_rule_id, now())
    on conflict (document_id, field_key)
    do update set updated_by = 'rule', source_id = p_rule_id, updated_at = now();
    v_status := 'applied';

  else
    -- assign_responsible / create_reminder / notify: domain write already performed by the
    -- caller (an entity connection, a reminders insert, a notification insert respectively) —
    -- this call only records the run outcome and audit event uniformly.
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

revoke all on function public.apply_rule_action(
  uuid, uuid, uuid, text, jsonb, text, uuid, text, uuid, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.apply_rule_action(
  uuid, uuid, uuid, text, jsonb, text, uuid, text, uuid, text, uuid, uuid, text
) to service_role;

-- Cursor pagination over documents.id (not a claim/skip-locked pattern like claim_import_chunk()
-- — a rule_backfill has no per-row table to lock rows in, so "claim" here means "advance past
-- this batch," not "reserve it against a concurrent claimer." A backfill is driven by exactly
-- one self-perpetuating job chain per rule_backfill_id (worker/jobs/backfill-rule.ts), so there
-- is no concurrent-claimer race to guard against the way import chunks (many chains per org) do.
-- p_filter's keys are read straight off rule_backfills.filter (documentTypeKey/dateFrom/dateTo,
-- see startRuleBackfillSchema) — nulls mean "no filter on this dimension."
create function public.claim_rule_backfill_documents(
  p_rule_backfill_id uuid,
  p_organization_id uuid,
  p_limit integer default 50,
  p_document_type_key text default null,
  p_date_from date default null,
  p_date_to date default null
)
returns setof public.documents
language plpgsql security definer set search_path = ''
as $$
declare
  v_cursor uuid;
begin
  if p_limit < 1 or p_limit > 500 then
    raise exception 'rule backfill chunk size must be between 1 and 500';
  end if;

  update public.rule_backfills
  set status = 'running', started_at = coalesce(started_at, now())
  where id = p_rule_backfill_id and organization_id = p_organization_id and status = 'pending';

  select cursor_document_id into v_cursor
  from public.rule_backfills
  where id = p_rule_backfill_id and organization_id = p_organization_id and status = 'running';

  if not found then
    return;
  end if;

  return query
    select d.*
    from public.documents d
    where d.organization_id = p_organization_id
      and d.deleted_at is null
      and (v_cursor is null or d.id > v_cursor)
      and (p_document_type_key is null or d.document_type_key = p_document_type_key)
      and (p_date_from is null or d.document_date >= p_date_from)
      and (p_date_to is null or d.document_date <= p_date_to)
    order by d.id
    limit p_limit;
end;
$$;

create function public.advance_rule_backfill_cursor(
  p_rule_backfill_id uuid, p_organization_id uuid, p_cursor_document_id uuid
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.rule_backfills
  set cursor_document_id = p_cursor_document_id
  where id = p_rule_backfill_id and organization_id = p_organization_id;
end;
$$;

create function public.increment_rule_backfill_progress(
  p_rule_backfill_id uuid, p_organization_id uuid, p_matched_delta integer, p_applied_delta integer
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.rule_backfills
  set matched_count = matched_count + p_matched_delta,
      applied_count = applied_count + p_applied_delta
  where id = p_rule_backfill_id and organization_id = p_organization_id;
end;
$$;

create function public.complete_rule_backfill(p_rule_backfill_id uuid, p_organization_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_backfill public.rule_backfills%rowtype;
begin
  update public.rule_backfills
  set status = 'completed', finished_at = now()
  where id = p_rule_backfill_id and organization_id = p_organization_id and status = 'running'
  returning * into v_backfill;

  if not found then return false; end if;

  insert into public.audit_logs (actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata)
  values (
    v_backfill.created_by, 'rule_backfill', p_organization_id, 'rule.backfill_completed',
    'rule_backfill', p_rule_backfill_id::text,
    jsonb_build_object('rule_id', v_backfill.rule_id, 'matched_count', v_backfill.matched_count,
      'applied_count', v_backfill.applied_count)
  );
  return true;
end;
$$;

create function public.fail_rule_backfill(p_rule_backfill_id uuid, p_organization_id uuid, p_reason text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_backfill public.rule_backfills%rowtype;
begin
  update public.rule_backfills
  set status = 'failed', finished_at = now()
  where id = p_rule_backfill_id and organization_id = p_organization_id
    and status not in ('completed', 'failed', 'cancelled')
  returning * into v_backfill;

  if not found then return false; end if;

  insert into public.audit_logs (actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata)
  values (
    v_backfill.created_by, 'rule_backfill', p_organization_id, 'rule.backfill_failed',
    'rule_backfill', p_rule_backfill_id::text, jsonb_build_object('reason', p_reason)
  );
  return true;
end;
$$;

-- Scoped strictly to rule_backfill_id (docs/adr/0010) — never a bare rule_id match, since
-- ongoing-trigger connections share rule_id with backfill-created ones.
create function public.undo_rule_backfill(p_rule_backfill_id uuid, p_organization_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from public.rule_backfills
    where id = p_rule_backfill_id and organization_id = p_organization_id
      and (created_by = auth.uid() or public.is_app_admin())
  ) then
    raise exception 'Backfill not found';
  end if;

  update public.connections
  set deleted_at = now()
  where organization_id = p_organization_id
    and rule_backfill_id = p_rule_backfill_id
    and deleted_at is null;

  get diagnostics v_count = row_count;

  insert into public.audit_logs (actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'user', p_organization_id, 'rule.backfill_undone', 'rule_backfill',
    p_rule_backfill_id::text, jsonb_build_object('connections_removed', v_count)
  );

  return v_count;
end;
$$;

revoke all on function public.claim_rule_backfill_documents(uuid, uuid, integer, text, date, date) from public, anon, authenticated;
revoke all on function public.advance_rule_backfill_cursor(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.increment_rule_backfill_progress(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_rule_backfill(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fail_rule_backfill(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_rule_backfill_documents(uuid, uuid, integer, text, date, date) to service_role;
grant execute on function public.advance_rule_backfill_cursor(uuid, uuid, uuid) to service_role;
grant execute on function public.increment_rule_backfill_progress(uuid, uuid, integer, integer) to service_role;
grant execute on function public.complete_rule_backfill(uuid, uuid) to service_role;
grant execute on function public.fail_rule_backfill(uuid, uuid, text) to service_role;
-- undo_rule_backfill checks auth.uid() itself (like merge_entities/transfer_organization_ownership)
-- so it's callable from a request-context client, not just service_role.
grant execute on function public.undo_rule_backfill(uuid, uuid) to authenticated;
