-- Documenti Level 0 — orgs extension columns + read-only role (docs/adr/0004: organization_id
-- naming, not the spec's org_id).

alter table public.organizations add column timezone text not null default 'Europe/Ljubljana';
alter table public.organizations add column locale text not null default 'sl-SI';
alter table public.organizations add column default_currency char(3) not null default 'EUR';
alter table public.organizations add column provisioning_status text not null default 'pending'
  check (provisioning_status in ('pending', 'provisioning', 'ready', 'provisioning_failed'));
alter table public.organizations add column ai_enabled boolean not null default false;

alter type public.organization_role add value 'read-only';

-- RLS is row-level, not column-level — a trigger blocks tenant writes to system-managed columns.
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
