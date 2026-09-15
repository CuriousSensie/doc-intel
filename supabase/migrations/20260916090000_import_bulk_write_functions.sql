-- Phase 3 M5/M6 shared write primitives. Both the dry-run validate() step and the real chunked
-- run() step write many rows' worth of different values per call — specs/06-importer.md:
-- "batch the updates — per-row counter writes will hammer the DB at 10k rows." A plain
-- PostgREST .update() applies one value set to every matched row, so a batch of *different*
-- per-row verdicts needs either N round trips or one statement — this is the one-statement
-- version, following the same service-role-only pattern as claim_upload_validation() et al.

create or replace function public.bulk_update_import_rows(
  p_import_job_id uuid,
  p_organization_id uuid,
  p_rows jsonb -- array of {id, status, result, error_code, error_message}
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'bulk_update_import_rows is service-role only';
  end if;

  update public.import_rows r
  set status = v.status,
      result = v.result,
      error_code = v.error_code,
      error_message = v.error_message,
      processed_at = now()
  from jsonb_to_recordset(p_rows) as v(
    id bigint, status text, result jsonb, error_code text, error_message text
  )
  where r.id = v.id
    and r.import_job_id = p_import_job_id
    and r.organization_id = p_organization_id;
end;
$$;

-- Atomic increment, not read-modify-write — specs/06-importer.md's chunk concurrency (default
-- 4 per org) means multiple chunks of the same job update these counters concurrently; a
-- read-then-write from application code would lose updates under real concurrency.
create or replace function public.increment_import_job_progress(
  p_import_job_id uuid,
  p_organization_id uuid,
  p_processed_delta integer,
  p_succeeded_delta integer,
  p_failed_delta integer,
  p_skipped_delta integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'increment_import_job_progress is service-role only';
  end if;

  update public.import_jobs
  set processed_rows = processed_rows + p_processed_delta,
      succeeded_rows = succeeded_rows + p_succeeded_delta,
      failed_rows = failed_rows + p_failed_delta,
      skipped_rows = skipped_rows + p_skipped_delta
  where id = p_import_job_id and organization_id = p_organization_id;
end;
$$;

revoke all on function public.bulk_update_import_rows(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.increment_import_job_progress(uuid, uuid, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.bulk_update_import_rows(uuid, uuid, jsonb) to service_role;
grant execute on function public.increment_import_job_progress(uuid, uuid, integer, integer, integer, integer) to service_role;
