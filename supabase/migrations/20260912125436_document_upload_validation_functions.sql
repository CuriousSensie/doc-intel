-- worker/jobs/validate-upload.ts's claim/complete/fail functions, following the same
-- conditional-UPDATE pattern as claim_provisioning/complete_provisioning/fail_provisioning
-- (20260826000000_tenant_provisioning.sql) rather than a session-scoped advisory lock — the
-- real work (storage download, AV scan) spans round-trips a lock held only for one RPC call
-- wouldn't cover.
--
-- Unlike the provisioning trio, these explicitly reject non-service_role callers: this table's
-- RLS has no update policy at all (20260828000000_document_uploads.sql), so without this check
-- a SECURITY DEFINER function in the public schema would otherwise let any authenticated member
-- flip another member's (or another tenant's) upload straight to 'validated'/'failed' via RPC —
-- the same `EXECUTE` default the security advisors already flag on the provisioning trio,
-- closed here rather than replicated (see protect_system_columns() for the same auth.role()
-- check pattern).

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
    and status = 'uploaded'
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

create or replace function public.complete_upload_validation(p_upload_id uuid, p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'complete_upload_validation is service-role only';
  end if;

  update public.document_uploads
  set status = 'validated'
  where id = p_upload_id
    and organization_id = p_organization_id;
end;
$$;

create or replace function public.fail_upload_validation(
  p_upload_id uuid, p_organization_id uuid, p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'fail_upload_validation is service-role only';
  end if;

  update public.document_uploads
  set status = 'failed', error_message = p_reason
  where id = p_upload_id
    and organization_id = p_organization_id;
end;
$$;
