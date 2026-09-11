-- Pomočnik Level 0/1 — entity_types (specs/02-data-model.md, specs/05-level-1-structure.md),
-- audit_logs.actor_type (ADR-0005), and the two provisioning-outcome functions (ADR-0008:
-- tenant provisioning's audit record must be atomic with the domain write, not best-effort
-- logEvent()). organization_id naming throughout (docs/adr/0004).

create table public.entity_types (
  id            uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key           text not null,
  name          text not null,
  name_plural   text not null,
  icon          text,
  is_system     boolean not null default false,
  field_schema  jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (organization_id, key)
);

create index on public.entity_types (organization_id);

create trigger entity_types_set_updated_at
  before update on public.entity_types
  for each row execute function public.set_updated_at();

alter table public.entity_types enable row level security;

create policy "entity_types_select_member" on public.entity_types
  for select using (public.is_organization_member(organization_id) or public.is_app_admin());

create policy "entity_types_write_member" on public.entity_types
  for all using (public.has_organization_write_access(organization_id) or public.is_app_admin())
  with check (public.has_organization_write_access(organization_id) or public.is_app_admin());

alter table public.audit_logs add column actor_type text not null default 'user'
  check (actor_type in ('user', 'system', 'rule', 'import', 'ai'));

-- Called only via the admin client (provisioning always runs server-side) — protect_system_columns()
-- lets this through because auth.role() there reflects the connecting client, not this
-- function's definer privileges.
create or replace function public.complete_provisioning(
  p_organization_id uuid,
  p_base_url text,
  p_service_user_id integer,
  p_group_id integer,
  p_api_token_encrypted bytea,
  p_storage_path_id integer,
  p_object_map jsonb -- [{object_type, paperless_id}, ...]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tenant_paperless_config (
    organization_id, base_url, service_user_id, group_id, api_token_encrypted, storage_path_id
  ) values (
    p_organization_id, p_base_url, p_service_user_id, p_group_id, p_api_token_encrypted,
    p_storage_path_id
  )
  on conflict (organization_id) do update set
    base_url = excluded.base_url,
    service_user_id = excluded.service_user_id,
    group_id = excluded.group_id,
    api_token_encrypted = excluded.api_token_encrypted,
    storage_path_id = excluded.storage_path_id,
    updated_at = now();

  insert into public.paperless_object_map (organization_id, object_type, paperless_id)
  select p_organization_id, elem->>'object_type', (elem->>'paperless_id')::integer
  from jsonb_array_elements(p_object_map) as elem
  on conflict (object_type, paperless_id) do nothing;

  -- specs/05-level-1-structure.md's four system entity types. is_system=true, safe to re-run
  -- (on conflict do nothing) — labels are Slovenian per specs/10-nonfunctional.md's locale default.
  insert into public.entity_types (organization_id, key, name, name_plural, is_system, field_schema)
  values
    (p_organization_id, 'customer', 'Stranka', 'Stranke', true, '[
      {"key":"vat","label":"Davčna številka","type":"string","required":false,"identifier_kind":"vat"},
      {"key":"company_reg","label":"Matična številka","type":"string","required":false,"identifier_kind":"company_reg"},
      {"key":"address","label":"Naslov","type":"string","required":false},
      {"key":"city","label":"Kraj","type":"string","required":false},
      {"key":"postal_code","label":"Poštna številka","type":"string","required":false},
      {"key":"country","label":"Država","type":"string","required":false},
      {"key":"email","label":"E-pošta","type":"email","required":false},
      {"key":"phone","label":"Telefon","type":"phone","required":false},
      {"key":"notes","label":"Opombe","type":"text","required":false}
    ]'::jsonb),
    (p_organization_id, 'project', 'Projekt', 'Projekti', true, '[
      {"key":"code","label":"Koda projekta","type":"string","required":false,"identifier_kind":"project_code"},
      {"key":"start_date","label":"Začetek","type":"date","required":false},
      {"key":"end_date","label":"Konec","type":"date","required":false},
      {"key":"status","label":"Status","type":"select","required":false,"options":["active","on_hold","closed"]},
      {"key":"budget","label":"Proračun","type":"monetary","required":false},
      {"key":"currency","label":"Valuta","type":"string","required":false},
      {"key":"notes","label":"Opombe","type":"text","required":false}
    ]'::jsonb),
    (p_organization_id, 'employee', 'Zaposleni', 'Zaposleni', true, '[
      {"key":"employee_no","label":"Številka zaposlenega","type":"string","required":false,"identifier_kind":"employee_no"},
      {"key":"email","label":"E-pošta","type":"email","required":false},
      {"key":"phone","label":"Telefon","type":"phone","required":false},
      {"key":"role","label":"Vloga","type":"string","required":false},
      {"key":"active","label":"Aktiven","type":"boolean","required":false}
    ]'::jsonb),
    (p_organization_id, 'contract', 'Pogodba', 'Pogodbe', true, '[
      {"key":"contract_no","label":"Številka pogodbe","type":"string","required":false,"identifier_kind":"contract_no"},
      {"key":"start_date","label":"Začetek","type":"date","required":false},
      {"key":"end_date","label":"Konec","type":"date","required":false},
      {"key":"notice_period_days","label":"Odpovedni rok (dni)","type":"integer","required":false},
      {"key":"value","label":"Vrednost","type":"monetary","required":false},
      {"key":"currency","label":"Valuta","type":"string","required":false},
      {"key":"status","label":"Status","type":"select","required":false,"options":["active","expired","terminated"]}
    ]'::jsonb)
  on conflict (organization_id, key) do nothing;

  update public.organizations set provisioning_status = 'ready' where id = p_organization_id;

  insert into public.audit_logs (actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata)
  values (
    null, 'system', p_organization_id, 'org.provisioned', 'organization', p_organization_id::text,
    jsonb_build_object('service_user_id', p_service_user_id, 'group_id', p_group_id)
  );
end;
$$;

-- Conditional claim, not a session-scoped advisory lock: the actual work spans external
-- Paperless API calls between DB round-trips, so a lock held only for this one call wouldn't
-- cover the real race anyway. Returns true if this call claimed it, false if already claimed
-- (or already ready) by a concurrent/prior attempt.
create or replace function public.claim_provisioning(p_organization_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.organizations
  set provisioning_status = 'provisioning'
  where id = p_organization_id
    and provisioning_status in ('pending', 'provisioning_failed')
  returning true;
$$;

create or replace function public.fail_provisioning(p_organization_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.organizations set provisioning_status = 'provisioning_failed'
  where id = p_organization_id;

  insert into public.audit_logs (actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata)
  values (
    null, 'system', p_organization_id, 'org.provisioning_failed', 'organization',
    p_organization_id::text, jsonb_build_object('reason', p_reason)
  );
end;
$$;
