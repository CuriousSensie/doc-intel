-- ADR-0019 follow-up: the Folders explorer view shows each folder's document count before it's
-- ever expanded (specs/12 "must not be slow" — one aggregate query for the whole tree beats an
-- exact count() per folder row). Org-membership checked explicitly since this is SECURITY DEFINER
-- and reachable directly via RPC, not only through the service layer's own ctx.orgId.
create or replace function public.get_folder_document_counts(p_organization_id uuid)
returns table(folder_id uuid, document_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_organization_member(p_organization_id) then
    raise exception 'Not a member of this organization';
  end if;

  return query
  select d.folder_id, count(*)::bigint
  from public.documents d
  where d.organization_id = p_organization_id
    and d.deleted_at is null
    and d.folder_id is not null
  group by d.folder_id;
end;
$$;

grant execute on function public.get_folder_document_counts(uuid) to authenticated;
