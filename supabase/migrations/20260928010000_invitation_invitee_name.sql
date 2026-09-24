-- Streamlined invite flow (see plan: organizations/team revamp): the owner/admin enters the
-- employee's name when inviting, so the accept-and-signup form can be pre-filled instead of
-- asking the invitee to type their own name again.

alter table public.organization_invitations
  add column invitee_name text;

-- CREATE OR REPLACE can't change a function's OUT-parameter row type (SQLSTATE 42P13) —
-- invitee_name is a new output column, so the old signature has to be dropped first.
drop function if exists public.get_organization_invitation(text);

create function public.get_organization_invitation(p_token text)
returns table (
  invitation_id uuid,
  organization_id uuid,
  organization_name text,
  email text,
  invitee_name text,
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
    i.invitee_name,
    i.role,
    i.expires_at,
    i.accepted_at,
    i.revoked_at
  from public.organization_invitations i
  join public.organizations o on o.id = i.organization_id
  where i.token_hash = encode(digest(p_token, 'sha256'), 'hex');
$$;
