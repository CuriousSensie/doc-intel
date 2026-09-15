-- Phase 3, milestone 1: import persistence, tenant-safe links, and source storage.
-- The import API and worker are added in later milestones; imports stay feature-gated.

create table public.import_jobs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status          text not null default 'draft'
    check (status in (
      'draft', 'mapping', 'validating', 'ready', 'running', 'paused',
      'completed', 'completed_with_errors', 'failed', 'cancelled'
    )),
  kind            text not null check (kind in ('documents', 'entities', 'metadata_only')),
  source_filename text,
  storage_key     text,
  total_rows      integer not null default 0 check (total_rows between 0 and 50000),
  processed_rows  integer not null default 0 check (processed_rows >= 0),
  succeeded_rows  integer not null default 0 check (succeeded_rows >= 0),
  failed_rows     integer not null default 0 check (failed_rows >= 0),
  skipped_rows    integer not null default 0 check (skipped_rows >= 0),
  mapping         jsonb not null default '{}'::jsonb,
  options         jsonb not null default '{}'::jsonb,
  error           text,
  created_by      uuid references auth.users(id) on delete set null,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, organization_id)
);

create index import_jobs_organization_created_idx
  on public.import_jobs (organization_id, created_at desc);
create index import_jobs_organization_status_idx
  on public.import_jobs (organization_id, status);

create trigger import_jobs_set_updated_at before update on public.import_jobs
  for each row execute function public.set_updated_at();

alter table public.import_jobs enable row level security;
create policy "import_jobs_select_member" on public.import_jobs
  for select to authenticated
  using (public.is_organization_member(organization_id) or public.is_app_admin());
-- Users create draft intents only. Status and counters are worker-managed.
create policy "import_jobs_insert_member" on public.import_jobs
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and status = 'draft'
    and total_rows = 0 and processed_rows = 0 and succeeded_rows = 0
    and failed_rows = 0 and skipped_rows = 0
    and started_at is null and finished_at is null
    and public.has_organization_write_access(organization_id)
  );

create table public.import_rows (
  id              bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_job_id   uuid not null,
  row_number      integer not null check (row_number > 0),
  raw             jsonb not null,
  status          text not null default 'pending'
    check (status in ('pending', 'processing', 'ok', 'skipped_duplicate', 'failed', 'needs_review')),
  result          jsonb,
  error_code      text,
  error_message   text,
  attempts        integer not null default 0 check (attempts >= 0),
  processed_at    timestamptz,
  unique (import_job_id, row_number),
  unique (id, organization_id),
  foreign key (import_job_id, organization_id)
    references public.import_jobs(id, organization_id) on delete cascade
);

create index import_rows_job_status_idx on public.import_rows (import_job_id, status);
create index import_rows_organization_job_idx
  on public.import_rows (organization_id, import_job_id);

alter table public.import_rows enable row level security;
create policy "import_rows_select_member" on public.import_rows
  for select to authenticated
  using (public.is_organization_member(organization_id) or public.is_app_admin());
-- Analyze/validate/run materialize and mutate rows through the service-role worker.

create table public.import_mappings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (length(btrim(name)) > 0),
  kind            text not null check (kind in ('documents', 'entities', 'metadata_only')),
  mapping         jsonb not null default '{}'::jsonb,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create index import_mappings_organization_created_idx
  on public.import_mappings (organization_id, created_at desc);
create trigger import_mappings_set_updated_at before update on public.import_mappings
  for each row execute function public.set_updated_at();

alter table public.import_mappings enable row level security;
create policy "import_mappings_select_member" on public.import_mappings
  for select to authenticated
  using (public.is_organization_member(organization_id) or public.is_app_admin());
create policy "import_mappings_insert_member" on public.import_mappings
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.has_organization_write_access(organization_id)
  );
create policy "import_mappings_update_member" on public.import_mappings
  for update to authenticated
  using (public.has_organization_write_access(organization_id) or public.is_app_admin())
  with check (public.has_organization_write_access(organization_id) or public.is_app_admin());
create policy "import_mappings_delete_member" on public.import_mappings
  for delete to authenticated
  using (public.has_organization_write_access(organization_id) or public.is_app_admin());

-- These composite FKs prevent a valid row/job id from being attached to a different tenant.
alter table public.documents
  add constraint documents_import_job_same_organization_fkey
  foreign key (import_job_id, organization_id)
  references public.import_jobs(id, organization_id) on delete set null (import_job_id);
create index documents_import_job_idx on public.documents (import_job_id)
  where import_job_id is not null;

alter table public.document_uploads
  add column import_row_id bigint,
  add column source_archive_key text,
  add constraint document_uploads_import_row_same_organization_fkey
    foreign key (import_row_id, organization_id)
    references public.import_rows(id, organization_id) on delete set null (import_row_id);
create index document_uploads_import_row_idx on public.document_uploads (import_row_id)
  where import_row_id is not null;

-- SECURITY DEFINER is needed for conditional worker transitions; EXECUTE is granted only
-- to service_role below. Every transition includes organization_id and terminal guards.
create function public.claim_import_chunk(
  p_import_job_id uuid, p_organization_id uuid, p_limit integer default 50
)
returns setof public.import_rows
language plpgsql security definer set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 50 then
    raise exception 'import chunk size must be between 1 and 50';
  end if;

  update public.import_jobs
  set status = 'running', started_at = coalesce(started_at, now())
  where id = p_import_job_id and organization_id = p_organization_id and status = 'ready';

  if not exists (
    select 1 from public.import_jobs
    where id = p_import_job_id and organization_id = p_organization_id and status = 'running'
  ) then
    return;
  end if;

  return query
    with chosen as (
      select id from public.import_rows
      where import_job_id = p_import_job_id
        and organization_id = p_organization_id
        and status = 'pending'
      order by row_number
      for update skip locked
      limit p_limit
    )
    update public.import_rows r set status = 'processing'
    from chosen
    where r.id = chosen.id and r.organization_id = p_organization_id
    returning r.*;
end;
$$;

create function public.complete_import_job(p_import_job_id uuid, p_organization_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_job public.import_jobs%rowtype;
begin
  update public.import_jobs j
  set status = case
        when failed_rows > 0 or exists (
          select 1 from public.import_rows r
          where r.import_job_id = j.id and r.organization_id = j.organization_id
            and r.status in ('failed', 'needs_review')
        ) then 'completed_with_errors'
        else 'completed'
      end,
      finished_at = now()
  where j.id = p_import_job_id and j.organization_id = p_organization_id
    and j.status = 'running'
    and j.processed_rows = j.total_rows
    and not exists (
      select 1 from public.import_rows r
      where r.import_job_id = j.id and r.organization_id = j.organization_id
        and r.status in ('pending', 'processing')
    )
  returning j.* into v_job;

  if not found then return false; end if;

  insert into public.audit_logs
    (actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata)
  values (
    v_job.created_by, 'import', p_organization_id, 'import.completed', 'import_job',
    p_import_job_id::text,
    jsonb_build_object('status', v_job.status, 'total_rows', v_job.total_rows,
      'succeeded_rows', v_job.succeeded_rows, 'failed_rows', v_job.failed_rows,
      'skipped_rows', v_job.skipped_rows)
  );
  return true;
end;
$$;

create function public.fail_import_job(
  p_import_job_id uuid, p_organization_id uuid, p_reason text
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_job public.import_jobs%rowtype;
begin
  update public.import_jobs j
  set status = 'failed', error = p_reason, finished_at = now()
  where j.id = p_import_job_id and j.organization_id = p_organization_id
    and j.status not in ('completed', 'completed_with_errors', 'failed', 'cancelled')
  returning j.* into v_job;

  if not found then return false; end if;

  insert into public.audit_logs
    (actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata)
  values (
    v_job.created_by, 'import', p_organization_id, 'import.failed', 'import_job',
    p_import_job_id::text, jsonb_build_object('reason', p_reason)
  );
  return true;
end;
$$;

revoke all on function public.claim_import_chunk(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.complete_import_job(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fail_import_job(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_import_chunk(uuid, uuid, integer) to service_role;
grant execute on function public.complete_import_job(uuid, uuid) to service_role;
grant execute on function public.fail_import_job(uuid, uuid, text) to service_role;

-- One progress surface: import_jobs counters, rather than background_operations.kind='import'.
-- Signed uploads are issued via the admin client, as for document-uploads and exports.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'import-sources', 'import-sources', false, 104857600,
  array[
    'text/csv', 'text/tab-separated-values', 'text/plain', 'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip', 'application/x-zip-compressed'
  ]::text[]
)
on conflict (id) do nothing;
