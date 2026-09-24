-- "Admin" is meant to be full management short of ownership (see plan: organizations/team
-- revamp) — but 20260922000000_document_visibility_rls.sql's owner-only visibility lock and
-- the can_manage_document()/can_edit_document()/get_document_permissions() functions it fed
-- only ever checked array['owner'], so an admin couldn't see, manage, or share a document
-- they didn't create. Extending all four to array['owner','admin'] gives admins the same
-- document reach as the owner; the owner-exclusive actions (transfer ownership, delete org,
-- block/remove members) are untouched — those still check array['owner'] alone.
--
-- Also closes a gap from the block_member() migration (20260928000000): that one only added
-- "and blocked_at is null" to is_organization_member()/has_organization_role(), but
-- has_organization_write_access() runs its own raw query instead of going through either
-- helper, so a blocked member kept write access to documents even after being blocked.

create or replace function public.has_organization_write_access(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    join public.organizations on organizations.id = organization_members.organization_id
    where organization_members.organization_id = target_organization_id
      and organization_members.user_id = auth.uid()
      and organization_members.role <> 'read-only'
      and organization_members.blocked_at is null
      and organizations.suspended_at is null
  );
$$;

drop policy if exists "documents_select_member" on public.documents;
create policy "documents_select_member" on public.documents
  for select using (
    (
      public.is_organization_member(organization_id)
      and (
        created_by = auth.uid()
        or public.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[])
      )
    )
    or public.is_app_admin()
  );

drop policy if exists "document_uploads_select_member" on public.document_uploads;
create policy "document_uploads_select_member" on public.document_uploads
  for select using (
    (
      public.is_organization_member(organization_id)
      and (
        created_by = auth.uid()
        or public.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[])
      )
    )
    or public.is_app_admin()
  );

create or replace function public.can_manage_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.documents d
    where d.id = p_document_id
      and d.deleted_at is null
      and public.is_organization_member(d.organization_id)
      and (
        d.created_by = auth.uid()
        or public.has_organization_role(d.organization_id, array['owner', 'admin']::public.organization_role[])
      )
  );
$$;

create or replace function public.can_edit_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.documents d
    where d.id = p_document_id
      and d.deleted_at is null
      and public.has_organization_write_access(d.organization_id)
      and (
        d.created_by = auth.uid()
        or public.has_organization_role(d.organization_id, array['owner', 'admin']::public.organization_role[])
        or exists (
          select 1 from public.document_shares s
          where s.document_id = d.id
            and (s.shared_with = auth.uid() or s.shared_with is null)
            and s.permission = 'edit'
        )
      )
  );
$$;

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
    or public.has_organization_role(v_org_id, array['owner', 'admin']::public.organization_role[])
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
