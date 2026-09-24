-- Feedback after 1.0.0: one organization per account, plus org-scoped member blocking
-- (distinct from profiles.suspended_at, which is a global app-admin suspension).
-- See plan: organizations/team revamp.

-- Defensive cleanup before the new uniqueness constraint: keep each user's earliest
-- membership row (their original org) and drop any later duplicates. In a fresh 1.0.0
-- deployment this should be a no-op; it exists so the migration is safe to run against
-- whatever data actually exists rather than assuming a clean slate.
delete from public.organization_members om
where om.id in (
  select id from (
    select id, row_number() over (
      partition by user_id order by created_at asc, id asc
    ) as rn
    from public.organization_members
  ) ranked
  where ranked.rn > 1
);

alter table public.organization_members
  add column blocked_at timestamptz;

alter table public.organization_members
  add constraint organization_members_user_id_key unique (user_id);

-- Blocking a member must cut off their access everywhere these gates are used (documents,
-- entities, custom fields, ...), not just in the team UI, so the exclusion belongs in the
-- shared RLS helpers rather than a new column check scattered across policies.
create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = target_organization_id
      and user_id = auth.uid()
      and blocked_at is null
  );
$$;

create or replace function public.has_organization_role(
  target_organization_id uuid,
  allowed_roles public.organization_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = target_organization_id
      and user_id = auth.uid()
      and role = any(allowed_roles)
      and blocked_at is null
  );
$$;

-- Defense in depth: inviteMemberAction already rejects invites to an email that already
-- belongs to any organization, but the DB is the actual source of truth for the
-- one-org-per-account rule (organization_members_user_id_key above), so accept must fail
-- with a clear message rather than a raw unique-violation if that invariant is ever
-- reached some other way.
create or replace function public.accept_organization_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  invitation public.organization_invitations%rowtype;
  caller_email text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  caller_email := auth.email();

  select * into invitation
  from public.organization_invitations
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
  for update;

  if invitation.id is null then
    raise exception 'Invitation not found';
  end if;

  if invitation.revoked_at is not null then
    raise exception 'Invitation has been revoked';
  end if;

  if invitation.accepted_at is not null then
    raise exception 'Invitation has already been accepted';
  end if;

  if invitation.expires_at <= now() then
    raise exception 'Invitation has expired';
  end if;

  if caller_email is null or lower(caller_email) <> lower(invitation.email) then
    raise exception 'Invitation email does not match the signed-in account';
  end if;

  if exists (
    select 1 from public.organization_members where user_id = auth.uid()
  ) then
    raise exception 'This account already belongs to an organization';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (invitation.organization_id, auth.uid(), invitation.role)
  on conflict (organization_id, user_id) do nothing;

  update public.organization_invitations
  set accepted_by = auth.uid(), accepted_at = now()
  where id = invitation.id;

  return invitation.organization_id;
end;
$$;

create or replace function public.create_organization(
  org_name text,
  org_slug text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if exists (
    select 1 from public.organization_members where user_id = auth.uid()
  ) then
    raise exception 'This account already belongs to an organization';
  end if;

  insert into public.organizations (name, slug, created_by)
  values (org_name, org_slug, auth.uid())
  returning id into new_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, auth.uid(), 'owner');

  return new_org_id;
end;
$$;

-- Org-scoped block/unblock. Same authorization shape and transactional audit convention as
-- update_member_role()/remove_member() (ADR-0008) — not a removal, the member row and role
-- history are preserved, but blocked_at set means is_organization_member()/
-- has_organization_role() both stop granting access immediately.
create or replace function public.block_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_user_id uuid;
  v_role public.organization_role;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select organization_id, user_id, role into v_org_id, v_user_id, v_role
  from public.organization_members
  where id = p_member_id;

  if v_org_id is null then
    raise exception 'Member not found';
  end if;

  if not public.has_organization_role(v_org_id, array['owner', 'admin']::public.organization_role[]) then
    raise exception 'Only an owner or admin can block members';
  end if;

  if v_user_id = auth.uid() then
    raise exception 'You can''t block yourself';
  end if;

  if v_role = 'owner' then
    raise exception 'The organization owner can''t be blocked';
  end if;

  update public.organization_members set blocked_at = now() where id = p_member_id;

  insert into public.audit_logs (
    actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata
  )
  values (
    auth.uid(), 'user', v_org_id, 'organization.member.blocked', 'organization_member',
    p_member_id::text, '{}'::jsonb
  );
end;
$$;

create or replace function public.unblock_member(p_member_id uuid)
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
    raise exception 'Only an owner or admin can unblock members';
  end if;

  update public.organization_members set blocked_at = null where id = p_member_id;

  insert into public.audit_logs (
    actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata
  )
  values (
    auth.uid(), 'user', v_org_id, 'organization.member.unblocked', 'organization_member',
    p_member_id::text, '{}'::jsonb
  );
end;
$$;
