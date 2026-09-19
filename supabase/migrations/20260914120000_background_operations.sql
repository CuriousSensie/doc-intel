-- Documenti Level 1 — Milestone 7: async bulk actions + export progress tracking.
-- specs/05-level-1-structure.md §Bulk business actions/§Export: "async execution above 50
-- items with progress" and "exports over 5,000 rows are always async" both need a row a
-- worker can update and the browser can poll — same shape as document_uploads (Phase 0).

create table public.background_operations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  kind             text not null
    check (kind in ('bulk_connect', 'bulk_paperless_edit', 'export')),
  status           text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  params           jsonb not null default '{}'::jsonb,
  total_count      integer,
  processed_count  integer not null default 0,
  success_count    integer not null default 0,
  failure_count    integer not null default 0,
  -- Per-item failure reporting (spec's explicit requirement) — small enough per operation
  -- (failures, not all items) that jsonb beats a child table here.
  failures         jsonb not null default '[]'::jsonb,
  result           jsonb,
  error_message    text,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz
);

create index on public.background_operations (organization_id, created_at desc);

create trigger background_operations_set_updated_at
  before update on public.background_operations
  for each row execute function public.set_updated_at();

alter table public.background_operations enable row level security;

create policy "background_operations_select_member" on public.background_operations
  for select using (public.is_organization_member(organization_id) or public.is_app_admin());

-- Only the trigger insert is user-facing; every status/progress update runs via the admin
-- client from a worker job (worker/jobs/bulk-action.ts, worker/jobs/export.ts) — same
-- deliberate no-update-policy convention as document_uploads.
create policy "background_operations_insert_member" on public.background_operations
  for insert
  with check (
    created_by = auth.uid()
    and public.has_organization_write_access(organization_id)
  );

-- Private bucket for generated export files. Downloads go through our own signed-URL route
-- (src/app/api/exports/[id]/download/route.ts), never a public bucket URL — same convention
-- as document-uploads/files/avatars (20260828000000_document_uploads.sql).
insert into storage.buckets (id, name, public, file_size_limit)
values ('exports', 'exports', false, 104857600)
on conflict (id) do nothing;
