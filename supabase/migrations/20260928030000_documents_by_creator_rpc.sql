-- Members tab doc-count column (see plan: organizations/team revamp) — a per-org group-by
-- count, cheaper as one aggregate query than pulling every document row over the client.
create or replace function public.count_documents_by_creator(p_organization_id uuid)
returns table (created_by uuid, document_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_organization_role(p_organization_id, array['owner', 'admin']::public.organization_role[]) then
    raise exception 'Only an owner or admin can view document counts by member';
  end if;

  return query
    select d.created_by, count(*) as document_count
    from public.documents d
    where d.organization_id = p_organization_id
      and d.deleted_at is null
      and d.created_by is not null
    group by d.created_by;
end;
$$;
