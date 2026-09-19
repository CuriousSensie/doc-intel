-- "Share with everyone": a document_shares row with shared_with NULL grants the permission to
-- every member of the organization. Read-only members still never edit (can_edit_document checks
-- the role), and an 'edit' everyone-grant implies view. Per-person rows are unchanged.

alter table public.document_shares alter column shared_with drop not null;
alter table public.document_shares drop constraint if exists document_shares_document_id_shared_with_key;

create unique index document_shares_person_unique
  on public.document_shares (document_id, shared_with) where shared_with is not null;
create unique index document_shares_everyone_unique
  on public.document_shares (document_id) where shared_with is null;

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
        or public.has_organization_role(d.organization_id, array['owner']::public.organization_role[])
        or exists (
          select 1 from public.document_shares s
          where s.document_id = d.id
            and (s.shared_with = auth.uid() or s.shared_with is null)
            and s.permission = 'edit'
        )
      )
  );
$$;

create or replace function public.is_document_shared_with_me(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.document_shares s
    where s.document_id = p_document_id
      and (s.shared_with = auth.uid() or s.shared_with is null)
      and public.is_organization_member(s.organization_id)
  );
$$;

drop policy if exists "document_shares_select" on public.document_shares;
create policy "document_shares_select" on public.document_shares
  for select using (
    shared_with = auth.uid()
    or (shared_with is null and public.is_organization_member(organization_id))
    or public.can_manage_document(document_id)
    or public.is_app_admin()
  );

-- p_user_id NULL = everyone in the organization.
create or replace function public.share_document(
  p_document_id uuid,
  p_user_id uuid,
  p_permission text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_created_by uuid;
  v_grantee_role public.organization_role;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_permission not in ('view', 'edit') then
    raise exception 'Permission must be view or edit';
  end if;

  select organization_id, created_by into v_org_id, v_created_by
  from public.documents
  where id = p_document_id and deleted_at is null;

  if v_org_id is null then
    raise exception 'Document not found';
  end if;

  if not public.can_manage_document(p_document_id)
     or not public.has_organization_write_access(v_org_id) then
    raise exception 'Only the document creator or an owner can share it';
  end if;

  if p_user_id is null then
    insert into public.document_shares (organization_id, document_id, shared_with, permission, created_by)
    values (v_org_id, p_document_id, null, p_permission, auth.uid())
    on conflict (document_id) where shared_with is null
    do update set permission = excluded.permission;
  else
    select role into v_grantee_role
    from public.organization_members
    where organization_id = v_org_id and user_id = p_user_id;

    if v_grantee_role is null then
      raise exception 'Recipient must be a member of this organization';
    end if;

    if p_user_id = auth.uid() or p_user_id = v_created_by or v_grantee_role = 'owner' then
      raise exception 'That member already has full access to this document';
    end if;

    if p_permission = 'edit' and v_grantee_role = 'read-only' then
      raise exception 'Read-only members cannot be given edit access';
    end if;

    insert into public.document_shares (organization_id, document_id, shared_with, permission, created_by)
    values (v_org_id, p_document_id, p_user_id, p_permission, auth.uid())
    on conflict (document_id, shared_with) where shared_with is not null
    do update set permission = excluded.permission;
  end if;

  insert into public.audit_logs (
    actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata
  )
  values (
    auth.uid(), 'user', v_org_id, 'document.shared', 'document', p_document_id::text,
    jsonb_build_object('sharedWith', coalesce(p_user_id::text, 'everyone'), 'permission', p_permission)
  );
end;
$$;

create or replace function public.unshare_document(p_document_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_deleted integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select organization_id into v_org_id
  from public.documents
  where id = p_document_id and deleted_at is null;

  if v_org_id is null then
    raise exception 'Document not found';
  end if;

  if not public.can_manage_document(p_document_id)
     or not public.has_organization_write_access(v_org_id) then
    raise exception 'Only the document creator or an owner can change sharing';
  end if;

  delete from public.document_shares
  where document_id = p_document_id and shared_with is not distinct from p_user_id;

  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'Share not found';
  end if;

  insert into public.audit_logs (
    actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata
  )
  values (
    auth.uid(), 'user', v_org_id, 'document.unshared', 'document', p_document_id::text,
    jsonb_build_object('sharedWith', coalesce(p_user_id::text, 'everyone'))
  );
end;
$$;
