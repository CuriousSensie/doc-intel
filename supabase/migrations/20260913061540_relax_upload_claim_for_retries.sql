-- Enabling BullMQ retries (src/lib/queue/index.ts's defaultJobOptions, added the same session
-- this migration lands) surfaced a real bug: claim_upload_validation() only claims from
-- 'uploaded', so once a transient failure (e.g. a one-off network blip found live during e2e
-- testing) leaves a row at 'validating', a BullMQ retry of the *same* job can never reclaim it
-- — the claim UPDATE matches zero rows, the job logs "skipped_not_claimable" and returns
-- successfully without doing anything, permanently stranding the row. A same-job retry must be
-- able to reclaim whatever status its own earlier attempt left the row in.
create or replace function public.claim_upload_validation(p_upload_id uuid, p_organization_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean;
begin
  if auth.role() <> 'service_role' then
    raise exception 'claim_upload_validation is service-role only';
  end if;

  update public.document_uploads
  set status = 'validating'
  where id = p_upload_id
    and organization_id = p_organization_id
    and status in ('uploaded', 'validating')
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;
