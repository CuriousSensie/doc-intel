-- Pomočnik Level 0 — orgs extension columns (specs/02-data-model.md), the read-only role
-- (specs/00-overview.md's RBAC minimum: owner/admin/member/read-only), and the guards both
-- require. Column naming is organization_id-style throughout, matching the boilerplate's
-- existing convention rather than the spec's literal org_id (docs/adr/0004).

alter table public.organizations add column timezone text not null default 'Europe/Ljubljana';
alter table public.organizations add column locale text not null default 'sl-SI';
alter table public.organizations add column default_currency char(3) not null default 'EUR';
alter table public.organizations add column provisioning_status text not null default 'pending'
  check (provisioning_status in ('pending', 'provisioning', 'ready', 'provisioning_failed'));
alter table public.organizations add column ai_enabled boolean not null default false;

alter type public.organization_role add value 'read-only';

-- System-managed columns: a tenant admin can update their org's name/logo (existing
-- "organizations_update_owner_admin" policy) but must never be able to write their own way
-- into "ready"/"ai_enabled=true" directly — those are set only by the provisioning job and by
-- the (Level 2) AI opt-in flow, both running as the service role. RLS is row-level, not
-- column-level, so a trigger is the enforcement point (same pattern as set_updated_at()).
create or replace function public.protect_system_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.provisioning_status is distinct from old.provisioning_status
      or new.ai_enabled is distinct from old.ai_enabled)
     and auth.role() <> 'service_role' then
    raise exception 'provisioning_status and ai_enabled are system-managed columns';
  end if;
  return new;
end;
$$;

create trigger organizations_protect_system_columns
  before update on public.organizations
  for each row execute function public.protect_system_columns();

-- A fresh "read-only" member must keep every existing read (is_organization_member() is
-- unchanged and deliberately still includes read-only) but lose every existing member-level
-- WRITE the boilerplate currently grants to any org member. The one such policy today is
-- files_insert_owner (docs/DATABASE.md: "insert: owner (and org member if org-scoped)") — audited
-- specifically for this migration; re-check this list if a future migration adds another
-- write policy keyed to is_organization_member() instead of has_organization_role().
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
      and organizations.suspended_at is null
  );
$$;

drop policy "files_insert_owner" on public.files;
create policy "files_insert_owner" on public.files
  for insert with check (
    owner_id = auth.uid()
    and (organization_id is null or public.has_organization_write_access(organization_id))
  );
