-- Organizations module: atomic operations that RLS alone cannot express, plus the
-- leave-organization policy. See docs/SECURITY.md for the rationale behind each function.

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

  insert into public.organizations (name, slug, created_by)
  values (org_name, org_slug, auth.uid())
  returning id into new_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, auth.uid(), 'owner');

  return new_org_id;
end;
$$;

create or replace function public.get_organization_invitation(p_token text)
returns table (
  invitation_id uuid,
  organization_id uuid,
  organization_name text,
  email text,
  role public.organization_role,
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    i.id,
    i.organization_id,
    o.name,
    i.email,
    i.role,
    i.expires_at,
    i.accepted_at,
    i.revoked_at
  from public.organization_invitations i
  join public.organizations o on o.id = i.organization_id
  where i.token_hash = encode(digest(p_token, 'sha256'), 'hex');
$$;

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

  insert into public.organization_members (organization_id, user_id, role)
  values (invitation.organization_id, auth.uid(), invitation.role)
  on conflict (organization_id, user_id) do nothing;

  update public.organization_invitations
  set accepted_by = auth.uid(), accepted_at = now()
  where id = invitation.id;

  return invitation.organization_id;
end;
$$;

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
end;
$$;

-- Allow a member to remove themselves (leave), unless they are the organization's
-- sole remaining owner. Ownership must be transferred before the last owner can leave.
create policy "organization_members_delete_self" on public.organization_members
  for delete using (
    user_id = auth.uid()
    and (
      role <> 'owner'
      or exists (
        select 1 from public.organization_members other_owner
        where other_owner.organization_id = organization_members.organization_id
          and other_owner.role = 'owner'
          and other_owner.user_id <> organization_members.user_id
      )
    )
  );
