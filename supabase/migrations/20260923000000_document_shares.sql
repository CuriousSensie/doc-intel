-- Per-document sharing: a document's creator or the org owner can grant another org member
-- 'view' or 'edit' access. Permission logic lives in security definer SQL functions (single
-- source of truth for the service layer) — this also avoids the RLS recursion documents and
-- document_shares policies would have if they queried each other directly. Writes go through
-- share_document/unshare_document (ADR-0008: audit row in the same transaction), never plain
-- inserts, so the table has no insert/update/delete policies.

create table public.document_shares (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id     uuid not null references public.documents(id) on delete cascade,
  shared_with     uuid not null references public.profiles(id) on delete cascade,
  permission      text not null check (permission in ('view', 'edit')),
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (document_id, shared_with)
);

create index document_shares_shared_with_idx on public.document_shares (shared_with, organization_id);
create index document_shares_document_idx on public.document_shares (document_id);
-- Leading organization_id index (specs/12 never-do #12). Also added by 20260927000000 for databases
-- that had already applied this file.
create index if not exists document_shares_organization_idx on public.document_shares (organization_id);

create trigger document_shares_set_updated_at
  before update on public.document_shares
  for each row execute function public.set_updated_at();

alter table public.document_shares enable row level security;

-- Creator or owner of the document.
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
        or public.has_organization_role(d.organization_id, array['owner']::public.organization_role[])
      )
  );
$$;

-- Manage rights or an 'edit' share, and never for a read-only member regardless of the share.
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
          where s.document_id = d.id and s.shared_with = auth.uid() and s.permission = 'edit'
        )
      )
  );
$$;

-- Used by the documents SELECT policy: any share (view or edit) grants read.
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
      and s.shared_with = auth.uid()
      and public.is_organization_member(s.organization_id)
  );
$$;

-- Bulk paths resolve their target ids through this so the Paperless call, mirror update and
-- provenance write all operate on the identical id set. 'manage' (delete) additionally needs
-- write access, matching deleteDocument's own role check.
create or replace function public.filter_document_ids(
  p_organization_id uuid,
  p_ids uuid[],
  p_required text
)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_required not in ('edit', 'manage') then
    raise exception 'p_required must be edit or manage';
  end if;

  return query
  select d.id
  from public.documents d
  where d.organization_id = p_organization_id
    and d.id = any(p_ids)
    and d.deleted_at is null
    and case
      when p_required = 'manage' then
        public.can_manage_document(d.id) and public.has_organization_write_access(d.organization_id)
      else public.can_edit_document(d.id)
    end;
end;
$$;

create policy "document_shares_select" on public.document_shares
  for select using (
    shared_with = auth.uid()
    or public.can_manage_document(document_id)
    or public.is_app_admin()
  );

drop policy if exists "documents_select_member" on public.documents;
create policy "documents_select_member" on public.documents
  for select using (
    (
      public.is_organization_member(organization_id)
      and (
        created_by = auth.uid()
        or public.has_organization_role(organization_id, array['owner']::public.organization_role[])
        or public.is_document_shared_with_me(id)
      )
    )
    or public.is_app_admin()
  );

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
  on conflict (document_id, shared_with)
  do update set permission = excluded.permission;

  insert into public.audit_logs (
    actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata
  )
  values (
    auth.uid(), 'user', v_org_id, 'document.shared', 'document', p_document_id::text,
    jsonb_build_object('sharedWith', p_user_id, 'permission', p_permission)
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
  where document_id = p_document_id and shared_with = p_user_id;

  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'Share not found';
  end if;

  insert into public.audit_logs (
    actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata
  )
  values (
    auth.uid(), 'user', v_org_id, 'document.unshared', 'document', p_document_id::text,
    jsonb_build_object('sharedWith', p_user_id)
  );
end;
$$;

grant execute on function public.can_manage_document(uuid) to authenticated;
grant execute on function public.can_edit_document(uuid) to authenticated;
grant execute on function public.is_document_shared_with_me(uuid) to authenticated;
grant execute on function public.filter_document_ids(uuid, uuid[], text) to authenticated;
grant execute on function public.share_document(uuid, uuid, text) to authenticated;
grant execute on function public.unshare_document(uuid, uuid) to authenticated;

-- Membership removal must not leave dangling grants (neither function had a cleanup hook).
create or replace function public.remove_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_user_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select organization_id, user_id into v_org_id, v_user_id
  from public.organization_members
  where id = p_member_id;

  if v_org_id is null then
    raise exception 'Member not found';
  end if;

  if not public.has_organization_role(v_org_id, array['owner', 'admin']::public.organization_role[]) then
    raise exception 'Only an owner or admin can remove members';
  end if;

  delete from public.document_shares
  where organization_id = v_org_id and shared_with = v_user_id;

  delete from public.organization_members where id = p_member_id;

  insert into public.audit_logs (
    actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata
  )
  values (
    auth.uid(), 'user', v_org_id, 'organization.member.removed', 'organization_member',
    p_member_id::text, '{}'::jsonb
  );
end;
$$;

create or replace function public.leave_organization(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
  v_role public.organization_role;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select id, role into v_member_id, v_role
  from public.organization_members
  where organization_id = p_organization_id and user_id = auth.uid();

  if v_member_id is null then
    raise exception 'Not a member of this organization';
  end if;

  if v_role = 'owner' and not exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id and role = 'owner' and user_id <> auth.uid()
  ) then
    raise exception 'You can''t leave as the only owner. Transfer ownership first.';
  end if;

  delete from public.document_shares
  where organization_id = p_organization_id and shared_with = auth.uid();

  delete from public.organization_members where id = v_member_id;

  insert into public.audit_logs (
    actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata
  )
  values (
    auth.uid(), 'user', p_organization_id, 'organization.member.left', 'organization',
    p_organization_id::text, '{}'::jsonb
  );
end;
$$;
