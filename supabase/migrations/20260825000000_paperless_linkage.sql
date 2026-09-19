-- Documenti Level 0 — Paperless linkage tables (specs/02-data-model.md). organization_id naming
-- (docs/adr/0004). Admin-client only — api_token_encrypted must never reach a browser, and
-- paperless_object_map is for server-side tenant resolution only.

create table public.tenant_paperless_config (
  organization_id     uuid primary key references public.organizations(id) on delete cascade,
  base_url             text not null,
  service_user_id      integer not null,
  group_id             integer not null,
  -- AES-GCM ciphertext, key from PAPERLESS_TOKEN_ENCRYPTION_KEY (env).
  api_token_encrypted  bytea not null,
  storage_path_id      integer,
  last_reconciled_at   timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger tenant_paperless_config_set_updated_at
  before update on public.tenant_paperless_config
  for each row execute function public.set_updated_at();

-- rls-coverage: admin-only (no policies)
alter table public.tenant_paperless_config enable row level security;

-- unique (object_type, paperless_id) without organization_id is deliberate: a cross-tenant
-- mapping is a DB error at write time, not a silent leak.
create table public.paperless_object_map (
  id            bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  object_type   text not null
    check (object_type in (
      'document', 'tag', 'document_type', 'custom_field', 'correspondent', 'storage_path',
      'workflow', 'saved_view'
    )),
  paperless_id  integer not null,
  local_id      uuid,
  created_at    timestamptz not null default now(),
  unique (object_type, paperless_id)
);

create index on public.paperless_object_map (organization_id, object_type);

-- rls-coverage: admin-only (no policies)
alter table public.paperless_object_map enable row level security;
