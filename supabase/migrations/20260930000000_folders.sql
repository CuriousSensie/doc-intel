-- ADR-0019: app-owned folder hierarchy. Folders live entirely in our own database — Paperless
-- stays unaware of them (D1, D2). Structurally mirrors document_shares (20260923000000): access
-- grants are written only through SECURITY DEFINER RPCs with an audit_logs row in the same
-- transaction (ADR-0008), never plain inserts, so folder_access has no insert/update/delete
-- policy. path/path_ids/depth are materialized on every row and recomputed for the whole affected
-- subtree inside move_folder()/rename_folder() — never computed lazily (specs/02-data-model.md).

create table public.folders (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  -- restrict, not cascade: deleting a folder with children must go through delete_folder()'s
  -- explicit mode handling, never a silent FK cascade that would orphan grandchildren's
  -- materialized path_ids.
  parent_folder_id  uuid references public.folders(id) on delete restrict,
  name              text not null check (length(btrim(name)) > 0),
  path              text not null,
  -- Root-to-self ancestor ids, including this folder's own id — used for cascading access checks
  -- (fa.folder_id = any(path_ids)) and cycle detection on move, without a recursive CTE per read.
  path_ids          uuid[] not null default '{}',
  depth             integer not null default 0,
  -- Reuses the rules engine's ConditionNode/conditionNodeSchema verbatim (src/modules/rules/
  -- rules.schemas.ts) — evaluated by evaluateConditions() on document.ingested, not a second
  -- matching grammar. Null means the folder has no auto-filing pattern.
  match_conditions  jsonb,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  unique (organization_id, parent_folder_id, name)
);

-- A plain unique constraint doesn't enforce nulls-equal, so root-level folders (parent_folder_id
-- is null) need their own partial index.
create unique index folders_org_root_name_idx
  on public.folders (organization_id, name)
  where parent_folder_id is null and deleted_at is null;

create index folders_organization_idx on public.folders (organization_id) where deleted_at is null;
create index folders_parent_idx on public.folders (organization_id, parent_folder_id) where deleted_at is null;
create index folders_path_ids_idx on public.folders using gin (path_ids);

create trigger folders_set_updated_at
  before update on public.folders
  for each row execute function public.set_updated_at();

alter table public.documents add column folder_id uuid references public.folders(id) on delete set null;
create index documents_folder_idx on public.documents (organization_id, folder_id) where deleted_at is null;

create table public.folder_access (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  folder_id       uuid not null references public.folders(id) on delete cascade,
  granted_to      uuid not null references public.profiles(id) on delete cascade,
  permission      text not null check (permission in ('view', 'edit')),
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (folder_id, granted_to)
);

create index folder_access_granted_to_idx on public.folder_access (granted_to, organization_id);
create index folder_access_folder_idx on public.folder_access (folder_id);
create index folder_access_organization_idx on public.folder_access (organization_id);

create trigger folder_access_set_updated_at
  before update on public.folder_access
  for each row execute function public.set_updated_at();

alter table public.folders enable row level security;
alter table public.folder_access enable row level security;

-- Creator or org owner/admin — parity with can_manage_document's array['owner','admin'] from day
-- one (ADR-0017's amendment), not a follow-up migration.
create or replace function public.can_manage_folder(p_folder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.folders f
    where f.id = p_folder_id
      and f.deleted_at is null
      and public.is_organization_member(f.organization_id)
      and (
        f.created_by = auth.uid()
        or public.has_organization_role(f.organization_id, array['owner','admin']::public.organization_role[])
      )
  );
$$;

-- Cascading read/write check: owner/admin, or an explicit folder_access grant on this folder or
-- any ancestor (this folder's own path_ids includes every ancestor id plus itself) — this is the
-- access-cascades-to-subfolders behavior.
create or replace function public.can_access_folder(p_folder_id uuid, p_require text default 'view')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.folders f
    where f.id = p_folder_id
      and f.deleted_at is null
      and public.is_organization_member(f.organization_id)
      and (
        public.has_organization_role(f.organization_id, array['owner','admin']::public.organization_role[])
        or exists (
          select 1 from public.folder_access fa
          where fa.granted_to = auth.uid()
            and fa.folder_id = any(f.path_ids)
            and (p_require = 'view' or fa.permission = 'edit')
        )
      )
  );
$$;

-- Extends documents_select_member below: a document filed in a folder the caller can access
-- (directly or via an ancestor grant) is visible even if not created/shared.
create or replace function public.can_access_document_via_folder(p_document_id uuid)
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
      and d.folder_id is not null
      and public.can_access_folder(d.folder_id, 'view')
  );
$$;

-- Bulk id-narrowing choke point mirroring filter_document_ids() — folder CRUD/access UI resolves
-- selections through this so the permission check and the eventual mutation operate on the
-- identical id set.
create or replace function public.filter_folder_ids(
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
  if p_required not in ('view', 'edit', 'manage') then
    raise exception 'p_required must be view, edit, or manage';
  end if;

  return query
  select f.id
  from public.folders f
  where f.organization_id = p_organization_id
    and f.id = any(p_ids)
    and f.deleted_at is null
    and case
      when p_required = 'manage' then public.can_manage_folder(f.id)
      else public.can_access_folder(f.id, p_required)
    end;
end;
$$;

create policy "folders_select_member" on public.folders
  for select using (
    (
      public.is_organization_member(organization_id)
      and (
        created_by = auth.uid()
        or public.has_organization_role(organization_id, array['owner','admin']::public.organization_role[])
        or public.can_access_folder(id, 'view')
      )
    )
    or public.is_app_admin()
  );

create policy "folder_access_select" on public.folder_access
  for select using (
    granted_to = auth.uid()
    or public.can_manage_folder(folder_id)
    or public.is_app_admin()
  );

-- Extends ADR-0017's documents_select_member (creator/owner-admin/share) with the folder cascade.
drop policy if exists "documents_select_member" on public.documents;
create policy "documents_select_member" on public.documents
  for select using (
    (
      public.is_organization_member(organization_id)
      and (
        created_by = auth.uid()
        or public.has_organization_role(organization_id, array['owner','admin']::public.organization_role[])
        or public.is_document_shared_with_me(id)
        or public.can_access_document_via_folder(id)
      )
    )
    or public.is_app_admin()
  );

create or replace function public.create_folder(
  p_organization_id uuid,
  p_parent_folder_id uuid,
  p_name text,
  p_match_conditions jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent record;
  v_path text;
  v_path_ids uuid[];
  v_depth integer;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_organization_write_access(p_organization_id) then
    raise exception 'You do not have write access to this organization';
  end if;

  if p_parent_folder_id is not null then
    select * into v_parent from public.folders
    where id = p_parent_folder_id and organization_id = p_organization_id and deleted_at is null;

    if v_parent.id is null then
      raise exception 'Parent folder not found';
    end if;

    if not public.can_manage_folder(p_parent_folder_id) then
      raise exception 'You do not have access to create a subfolder here';
    end if;

    v_path := v_parent.path || '/' || p_name;
    v_path_ids := v_parent.path_ids;
    v_depth := v_parent.depth + 1;
  else
    v_path := '/' || p_name;
    v_path_ids := '{}';
    v_depth := 0;
  end if;

  insert into public.folders (organization_id, parent_folder_id, name, path, path_ids, depth, match_conditions, created_by)
  values (p_organization_id, p_parent_folder_id, p_name, v_path, '{}', v_depth, p_match_conditions, auth.uid())
  returning id into v_id;

  -- path_ids includes this folder's own id (see can_access_folder's ancestor-or-self semantics).
  update public.folders set path_ids = v_path_ids || v_id where id = v_id;

  insert into public.audit_logs (
    actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata
  )
  values (
    auth.uid(), 'user', p_organization_id, 'folder.created', 'folder', v_id::text,
    jsonb_build_object('name', p_name, 'parentFolderId', p_parent_folder_id)
  );

  return v_id;
end;
$$;

create or replace function public.rename_folder(p_folder_id uuid, p_new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder record;
  v_old_path text;
  v_new_path text;
  v_parent_path text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_folder from public.folders where id = p_folder_id and deleted_at is null;
  if v_folder.id is null then
    raise exception 'Folder not found';
  end if;

  if not public.can_manage_folder(p_folder_id) or not public.has_organization_write_access(v_folder.organization_id) then
    raise exception 'You do not have access to rename this folder';
  end if;

  v_old_path := v_folder.path;
  v_parent_path := left(v_old_path, length(v_old_path) - length(v_folder.name) - 1);
  v_new_path := v_parent_path || '/' || p_new_name;

  update public.folders set name = p_new_name, path = v_new_path where id = p_folder_id;

  -- Rewrite the path prefix for every descendant in one statement (path_ids @> array[id] selects
  -- the folder itself and every descendant since path_ids always includes self).
  update public.folders
  set path = v_new_path || substring(path from length(v_old_path) + 1)
  where organization_id = v_folder.organization_id
    and path_ids @> array[p_folder_id]
    and id <> p_folder_id;

  insert into public.audit_logs (
    actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata
  )
  values (
    auth.uid(), 'user', v_folder.organization_id, 'folder.renamed', 'folder', p_folder_id::text,
    jsonb_build_object('oldName', v_folder.name, 'newName', p_new_name)
  );
end;
$$;

create or replace function public.move_folder(p_folder_id uuid, p_new_parent_folder_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder record;
  v_new_parent record;
  v_old_path text;
  v_new_path text;
  v_new_path_ids uuid[];
  v_depth_delta integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_folder from public.folders where id = p_folder_id and deleted_at is null;
  if v_folder.id is null then
    raise exception 'Folder not found';
  end if;

  if not public.can_manage_folder(p_folder_id) or not public.has_organization_write_access(v_folder.organization_id) then
    raise exception 'You do not have access to move this folder';
  end if;

  if p_new_parent_folder_id = p_folder_id then
    raise exception 'A folder cannot be moved into itself';
  end if;

  if p_new_parent_folder_id is not null then
    select * into v_new_parent from public.folders
    where id = p_new_parent_folder_id and organization_id = v_folder.organization_id and deleted_at is null;

    if v_new_parent.id is null then
      raise exception 'Destination folder not found';
    end if;

    if not public.can_manage_folder(p_new_parent_folder_id) then
      raise exception 'You do not have access to move a folder here';
    end if;

    -- Cycle check: the destination's own ancestor chain (path_ids, which includes itself) must
    -- not contain the folder being moved — that would mean moving it into its own descendant.
    if v_new_parent.path_ids @> array[p_folder_id] then
      raise exception 'A folder cannot be moved into one of its own subfolders';
    end if;

    v_new_path := v_new_parent.path || '/' || v_folder.name;
    v_new_path_ids := v_new_parent.path_ids || p_folder_id;
    v_depth_delta := (v_new_parent.depth + 1) - v_folder.depth;
  else
    v_new_path := '/' || v_folder.name;
    v_new_path_ids := array[p_folder_id];
    v_depth_delta := 0 - v_folder.depth;
  end if;

  v_old_path := v_folder.path;

  update public.folders
  set parent_folder_id = p_new_parent_folder_id,
      path = v_new_path,
      path_ids = v_new_path_ids,
      depth = array_length(v_new_path_ids, 1) - 1
  where id = p_folder_id;

  -- Descendants: rewrite the path prefix, splice the new ancestor chain onto each descendant's
  -- own remaining path_ids suffix, and shift depth by the same delta the moved folder itself got
  -- (relative depths within the subtree never change on a move).
  update public.folders d
  set path = v_new_path || substring(d.path from length(v_old_path) + 1),
      path_ids = v_new_path_ids || d.path_ids[(array_length(v_folder.path_ids, 1) + 1):array_length(d.path_ids, 1)],
      depth = d.depth + v_depth_delta
  where d.organization_id = v_folder.organization_id
    and d.path_ids @> array[p_folder_id]
    and d.id <> p_folder_id;

  insert into public.audit_logs (
    actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata
  )
  values (
    auth.uid(), 'user', v_folder.organization_id, 'folder.moved', 'folder', p_folder_id::text,
    jsonb_build_object('fromParentId', v_folder.parent_folder_id, 'toParentId', p_new_parent_folder_id)
  );
end;
$$;

-- mode: 'require_empty' (default) refuses if the folder has child folders or documents;
-- 'reassign_documents_to_null' unfiles its direct documents first; 'reassign_documents_to' moves
-- them to p_reassign_to_folder_id first; 'cascade_delete_subfolders' soft-deletes the whole
-- subtree. All modes require the folder itself to already have no child folders except the last
-- one, which recurses. Soft delete only (deleted_at), matching documents' convention — folders
-- are never hard-deleted.
create or replace function public.delete_folder(
  p_folder_id uuid,
  p_mode text default 'require_empty',
  p_reassign_to_folder_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder record;
  v_child_count integer;
  v_document_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_mode not in ('require_empty', 'reassign_documents_to_null', 'reassign_documents_to', 'cascade_delete_subfolders') then
    raise exception 'Invalid delete mode';
  end if;

  select * into v_folder from public.folders where id = p_folder_id and deleted_at is null;
  if v_folder.id is null then
    raise exception 'Folder not found';
  end if;

  if not public.can_manage_folder(p_folder_id) or not public.has_organization_write_access(v_folder.organization_id) then
    raise exception 'You do not have access to delete this folder';
  end if;

  select count(*) into v_child_count from public.folders
  where parent_folder_id = p_folder_id and deleted_at is null;

  select count(*) into v_document_count from public.documents
  where folder_id = p_folder_id and deleted_at is null;

  if p_mode = 'require_empty' and (v_child_count > 0 or v_document_count > 0) then
    raise exception 'Folder is not empty';
  end if;

  if p_mode = 'reassign_documents_to' then
    if p_reassign_to_folder_id is null then
      raise exception 'reassign_documents_to requires a target folder';
    end if;
    if not public.can_manage_folder(p_reassign_to_folder_id) then
      raise exception 'You do not have access to the reassignment target folder';
    end if;
    update public.documents set folder_id = p_reassign_to_folder_id
    where folder_id = p_folder_id and organization_id = v_folder.organization_id and deleted_at is null;
  elsif p_mode = 'reassign_documents_to_null' then
    update public.documents set folder_id = null
    where folder_id = p_folder_id and organization_id = v_folder.organization_id and deleted_at is null;
  end if;

  if p_mode = 'cascade_delete_subfolders' then
    -- Unfile every document anywhere in the subtree (this folder + all descendants), then
    -- soft-delete the whole subtree in one statement.
    update public.documents set folder_id = null
    where organization_id = v_folder.organization_id
      and folder_id in (select id from public.folders where path_ids @> array[p_folder_id]);

    update public.folders set deleted_at = now()
    where organization_id = v_folder.organization_id and path_ids @> array[p_folder_id];
  else
    update public.folders set deleted_at = now() where id = p_folder_id;
  end if;

  insert into public.audit_logs (
    actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata
  )
  values (
    auth.uid(), 'user', v_folder.organization_id, 'folder.deleted', 'folder', p_folder_id::text,
    jsonb_build_object('mode', p_mode, 'reassignToFolderId', p_reassign_to_folder_id)
  );
end;
$$;

-- Structural mirror of share_document(): rejects granting to self/creator/owner (already full
-- access), rejects 'edit' for a read-only org member, upserts on (folder_id, granted_to).
create or replace function public.grant_folder_access(
  p_folder_id uuid,
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
  from public.folders
  where id = p_folder_id and deleted_at is null;

  if v_org_id is null then
    raise exception 'Folder not found';
  end if;

  if not public.can_manage_folder(p_folder_id) or not public.has_organization_write_access(v_org_id) then
    raise exception 'Only the folder creator or an owner/admin can grant access to it';
  end if;

  select role into v_grantee_role
  from public.organization_members
  where organization_id = v_org_id and user_id = p_user_id;

  if v_grantee_role is null then
    raise exception 'Recipient must be a member of this organization';
  end if;

  if p_user_id = auth.uid() or p_user_id = v_created_by or v_grantee_role in ('owner', 'admin') then
    raise exception 'That member already has full access to this folder';
  end if;

  if p_permission = 'edit' and v_grantee_role = 'read-only' then
    raise exception 'Read-only members cannot be given edit access';
  end if;

  insert into public.folder_access (organization_id, folder_id, granted_to, permission, created_by)
  values (v_org_id, p_folder_id, p_user_id, p_permission, auth.uid())
  on conflict (folder_id, granted_to)
  do update set permission = excluded.permission;

  insert into public.audit_logs (
    actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata
  )
  values (
    auth.uid(), 'user', v_org_id, 'folder.access_granted', 'folder', p_folder_id::text,
    jsonb_build_object('grantedTo', p_user_id, 'permission', p_permission)
  );
end;
$$;

create or replace function public.revoke_folder_access(p_folder_id uuid, p_user_id uuid)
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

  select organization_id into v_org_id from public.folders where id = p_folder_id and deleted_at is null;
  if v_org_id is null then
    raise exception 'Folder not found';
  end if;

  if not public.can_manage_folder(p_folder_id) or not public.has_organization_write_access(v_org_id) then
    raise exception 'Only the folder creator or an owner/admin can change its access grants';
  end if;

  delete from public.folder_access where folder_id = p_folder_id and granted_to = p_user_id;

  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'Grant not found';
  end if;

  insert into public.audit_logs (
    actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata
  )
  values (
    auth.uid(), 'user', v_org_id, 'folder.access_revoked', 'folder', p_folder_id::text,
    jsonb_build_object('grantedTo', p_user_id)
  );
end;
$$;

grant execute on function public.can_manage_folder(uuid) to authenticated;
grant execute on function public.can_access_folder(uuid, text) to authenticated;
grant execute on function public.can_access_document_via_folder(uuid) to authenticated;
grant execute on function public.filter_folder_ids(uuid, uuid[], text) to authenticated;
grant execute on function public.create_folder(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.rename_folder(uuid, text) to authenticated;
grant execute on function public.move_folder(uuid, uuid) to authenticated;
grant execute on function public.delete_folder(uuid, text, uuid) to authenticated;
grant execute on function public.grant_folder_access(uuid, uuid, text) to authenticated;
grant execute on function public.revoke_folder_access(uuid, uuid) to authenticated;

-- Membership removal/leaving must not leave dangling folder grants either (same bug class
-- 20260923000000_document_shares.sql already fixed once for document_shares).
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

  delete from public.folder_access
  where organization_id = v_org_id and granted_to = v_user_id;

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

  delete from public.folder_access
  where organization_id = p_organization_id and granted_to = auth.uid();

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
