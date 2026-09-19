-- One round trip for the document Permissions tab. It used to assemble this from ~10 separate
-- queries (permission checks repeated per helper, separate profile lookups per section).
-- security definer because it reads other members' names/emails, which profiles RLS hides — so
-- the visibility check (member AND creator/owner/shared) is replicated explicitly, and the member
-- list is only returned to someone who can manage the document.
--   owner   = the organization's owner   createdBy = the member who uploaded it (may be null)

create or replace function public.get_document_permissions(p_document_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_created_by uuid;
  v_can_manage boolean;
  v_owner jsonb;
  v_creator jsonb;
  v_shares jsonb;
  v_members jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select organization_id, created_by into v_org_id, v_created_by
  from public.documents
  where id = p_document_id and deleted_at is null;

  v_can_manage := v_org_id is not null and (
    v_created_by = auth.uid()
    or public.has_organization_role(v_org_id, array['owner']::public.organization_role[])
  );

  if v_org_id is null
     or not public.is_organization_member(v_org_id)
     or not (v_can_manage or public.is_document_shared_with_me(p_document_id)) then
    raise exception 'Document not found' using errcode = 'P0002';
  end if;

  select jsonb_build_object('name', p.name, 'email', p.email) into v_owner
  from public.organization_members m
  join public.profiles p on p.id = m.user_id
  where m.organization_id = v_org_id and m.role = 'owner'
  order by m.created_at
  limit 1;

  select jsonb_build_object('name', p.name, 'email', p.email) into v_creator
  from public.profiles p
  where p.id = v_created_by;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'userId', s.shared_with,
      'permission', s.permission,
      'createdAt', s.created_at,
      'name', p.name,
      'email', p.email
    ) order by s.created_at
  ), '[]'::jsonb) into v_shares
  from public.document_shares s
  left join public.profiles p on p.id = s.shared_with
  where s.document_id = p_document_id
    and (v_can_manage or s.shared_with is null or s.shared_with = auth.uid());

  if v_can_manage then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'userId', m.user_id,
        'name', p.name,
        'email', p.email,
        'isReadOnly', m.role = 'read-only'
      ) order by lower(coalesce(p.name, p.email))
    ), '[]'::jsonb) into v_members
    from public.organization_members m
    join public.profiles p on p.id = m.user_id
    where m.organization_id = v_org_id
      and m.role <> 'owner'
      and m.user_id <> auth.uid()
      and m.user_id is distinct from v_created_by;
  end if;

  return jsonb_build_object(
    'owner', v_owner,
    'createdBy', v_creator,
    'canManage', v_can_manage,
    'currentUserId', auth.uid(),
    'shares', v_shares,
    'members', v_members
  );
end;
$$;

grant execute on function public.get_document_permissions(uuid) to authenticated;
