-- Pomočnik Level 0 — Paperless linkage tables (specs/02-data-model.md §Paperless linkage,
-- specs/01-architecture.md §Tenancy model). organization_id naming, not org_id (docs/adr/0004).
--
-- Every Paperless call for tenant work goes through paperlessFor(orgId)
-- (src/lib/paperless/client.ts, Phase 1 — not yet written), which resolves these rows via the
-- Supabase ADMIN client. Neither table is ever readable by a tenant-facing RLS-scoped query —
-- api_token_encrypted must never reach a browser, and paperless_object_map exists purely for
-- server-side tenant resolution (the event-bridge webhook, reconciliation). Both get RLS
-- enabled with NO policies at all, matching the existing boilerplate convention for
-- admin-client-only tables (stripe_customers, subscriptions, webhook_events —
-- docs/DATABASE.md), so the only way to read or write them is the service-role client.

create table public.tenant_paperless_config (
  organization_id     uuid primary key references public.organizations(id) on delete cascade,
  base_url             text not null,
  service_user_id      integer not null,
  group_id             integer not null,
  -- AES-GCM ciphertext; key comes from PAPERLESS_TOKEN_ENCRYPTION_KEY (env, never in the repo —
  -- see infra/.env.example). Decrypted only inside src/lib/paperless/client.ts.
  api_token_encrypted  bytea not null,
  storage_path_id      integer,
  last_reconciled_at   timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger tenant_paperless_config_set_updated_at
  before update on public.tenant_paperless_config
  for each row execute function public.set_updated_at();

-- rls-coverage: admin-only (no policies) — see header comment above.
alter table public.tenant_paperless_config enable row level security;

-- Maps any Paperless object we created to its owning tenant. The event-bridge webhook
-- (src/app/api/internal/paperless/document-consumed/route.ts, Phase 1) resolves a
-- paperless_document_id to a tenant through this table — never by asking Paperless "whose
-- document is this" as a guess, and never by trying each tenant's service user in turn.
--
-- unique (object_type, paperless_id) WITHOUT organization_id is deliberate (specs/02-data-model.md):
-- a Paperless object belongs to exactly one tenant, so this constraint turns a cross-tenant
-- mapping bug into a database error at write time instead of a silent leak.
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

-- rls-coverage: admin-only (no policies) — see header comment above.
alter table public.paperless_object_map enable row level security;
