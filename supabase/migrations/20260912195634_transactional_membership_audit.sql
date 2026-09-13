-- ADR-0008 ("Transactional audit writes for business-critical mutations") names "permission
-- changes" as one of the mutation categories requiring a guaranteed, same-transaction audit
-- row — not best-effort logEvent() (src/lib/events/index.ts explicitly swallows sink failures).
-- role changes, ownership transfer, and membership removal were all still going through a
-- plain mutation + a separate logEvent() call; converted to the same pattern
-- complete_provisioning()/create_organization() already use. auth.uid()/has_organization_role()
-- checks are replicated explicitly here (security definer bypasses RLS) rather than relying on
-- organization_members_manage_owner_admin's policy, matching transfer_organization_ownership's
-- own existing convention below.

create or replace function public.update_member_role(p_member_id uuid, p_role public.organization_role)
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
  from public.organization_members
  where id = p_member_id;

  if v_org_id is null then
    raise exception 'Member not found';
  end if;

  if not public.has_organization_role(v_org_id, array['owner', 'admin']::public.organization_role[]) then
    raise exception 'Only an owner or admin can change member roles';
  end if;

  update public.organization_members set role = p_role where id = p_member_id;

  insert into public.audit_logs (
    actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata
  )
  values (
    auth.uid(), 'user', v_org_id, 'organization.member.role_changed', 'organization_member',
    p_member_id::text, jsonb_build_object('role', p_role)
  );
end;
$$;

create or replace function public.remove_member(p_member_id uuid)
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
  from public.organization_members
  where id = p_member_id;

  if v_org_id is null then
    raise exception 'Member not found';
  end if;

  if not public.has_organization_role(v_org_id, array['owner', 'admin']::public.organization_role[]) then
    raise exception 'Only an owner or admin can remove members';
  end if;

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

-- Same "permission change" category — voluntary self-removal, not just admin-driven removal.
-- Replaces organization_members_delete_self's RLS-policy-as-business-logic (a delete silently
-- filtered to 0 rows when you're the sole owner) with an explicit exception, since this no
-- longer goes through the caller's RLS-scoped client at all.
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

-- Unchanged auth/transfer logic, only the audit insert is new.
create or replace function public.transfer_organization_ownership(
  p_org_id uuid,
  p_new_owner_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_organization_role(p_org_id, array['owner']::public.organization_role[]) then
    raise exception 'Only the current owner can transfer ownership';
  end if;

  if not exists (
    select 1 from public.organization_members
    where organization_id = p_org_id and user_id = p_new_owner_id
  ) then
    raise exception 'New owner must already be a member of the organization';
  end if;

  update public.organization_members
  set role = 'owner'
  where organization_id = p_org_id and user_id = p_new_owner_id;

  update public.organization_members
  set role = 'admin'
  where organization_id = p_org_id and user_id = auth.uid() and user_id <> p_new_owner_id;

  insert into public.audit_logs (
    actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata
  )
  values (
    auth.uid(), 'user', p_org_id, 'organization.ownership_transferred', 'organization',
    p_org_id::text, jsonb_build_object('newOwnerId', p_new_owner_id)
  );
end;
$$;
