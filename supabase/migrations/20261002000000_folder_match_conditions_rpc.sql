-- ADR-0019 follow-up: a folder's auto-file pattern (match_conditions) could never be saved.
-- `folders` only ever had a SELECT policy (20260930000000_folders.sql); updateFolderMatchConditions()
-- wrote the column through the RLS-scoped client, so Postgres silently dropped the row (0 rows,
-- no error) and the editor reported success while nothing persisted. Every other folder mutation
-- already goes through a SECURITY DEFINER RPC with a same-transaction audit row (ADR-0008) — this
-- closes the one outlier instead of adding a table UPDATE policy that would bypass that convention.
create or replace function public.update_folder_match_conditions(
  p_folder_id uuid,
  p_match_conditions jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select organization_id into v_org_id
  from public.folders
  where id = p_folder_id and deleted_at is null;

  if v_org_id is null then
    raise exception 'Folder not found';
  end if;

  if not public.can_manage_folder(p_folder_id) or not public.has_organization_write_access(v_org_id) then
    raise exception 'You do not have access to edit this folder''s matching pattern';
  end if;

  update public.folders set match_conditions = p_match_conditions where id = p_folder_id;

  insert into public.audit_logs (
    actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata
  )
  values (
    auth.uid(), 'user', v_org_id, 'folder.match_conditions_updated', 'folder', p_folder_id::text,
    jsonb_build_object('hasPattern', p_match_conditions is not null)
  );
end;
$$;

grant execute on function public.update_folder_match_conditions(uuid, jsonb) to authenticated;
