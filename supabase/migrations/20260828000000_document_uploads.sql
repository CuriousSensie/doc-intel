-- Documenti Level 0 — the `documents` mirror table (specs/02-data-model.md) and
-- document_uploads (specs/01-architecture.md §Upload), together since document_uploads.
-- document_id references documents.

-- Paperless owns the file and its text; this mirrors the minimum needed to join/list/filter
-- without a Paperless round-trip per row. Never OCR text — that's the second-search-engine
-- non-goal (D1).
create table public.documents (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  paperless_document_id  integer not null,
  title                  text not null,
  document_type_key      text,
  document_date          date,
  correspondent_name     text,
  page_count             integer,
  byte_size              bigint,
  mime_type              text,
  checksum               text,
  status                 text not null default 'ready'
    check (status in ('pending', 'processing', 'ready', 'failed', 'orphaned')),
  source                 text not null default 'upload'
    check (source in ('upload', 'import', 'email', 'template')),
  import_job_id          uuid,
  synced_at              timestamptz,
  created_by             uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  unique (organization_id, paperless_document_id)
);

create index on public.documents (organization_id, document_type_key) where deleted_at is null;
create index on public.documents (organization_id, document_date desc) where deleted_at is null;
create index on public.documents (organization_id, checksum);

create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

alter table public.documents enable row level security;

create policy "documents_select_member" on public.documents
  for select using (public.is_organization_member(organization_id) or public.is_app_admin());

-- Only the sync worker (admin client) writes this table — see worker/jobs/sync-paperless-
-- document.ts (shared by upload, webhook, and reconciliation) — so there is no user-facing
-- insert/update/delete policy.

-- Tracks the direct-to-storage upload flow: upload-intent creates a 'pending' row + signed
-- URL, the browser PUTs straight to storage.buckets (bypassing our server), upload-complete
-- flips it to 'uploaded' and enqueues the worker pipeline.
create table public.document_uploads (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  storage_path        text not null,
  filename            text not null,
  declared_mime_type  text not null,
  size_bytes          bigint not null,
  status              text not null default 'pending'
    check (status in (
      'pending', 'uploaded', 'validating', 'validated', 'submitting', 'processing',
      'completed', 'failed', 'expired'
    )),
  error_message       text,
  -- Paperless's own task id, persisted as soon as post_document/ returns it — a crashed worker
  -- retries by polling this same task_id rather than re-submitting the file.
  paperless_task_id   text,
  document_id         uuid references public.documents(id),
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  expires_at          timestamptz not null
);

create index on public.document_uploads (organization_id, created_at desc);
-- expire-abandoned-uploads.ts's sweep target — only ever scans rows still stuck pre-upload.
create index document_uploads_expiry_idx on public.document_uploads (expires_at)
  where status in ('pending', 'uploaded');

create trigger document_uploads_set_updated_at
  before update on public.document_uploads
  for each row execute function public.set_updated_at();

alter table public.document_uploads enable row level security;

create policy "document_uploads_select_member" on public.document_uploads
  for select using (public.is_organization_member(organization_id) or public.is_app_admin());

-- Only the initial insert is user-facing (upload-intent, under the uploader's own session) —
-- every status transition after that runs via the admin client from a worker job, so there is
-- deliberately no update/delete policy here.
create policy "document_uploads_insert_member" on public.document_uploads
  for insert
  with check (
    created_by = auth.uid()
    and public.has_organization_write_access(organization_id)
  );

-- No storage.objects RLS policies: signed-upload-url generation goes through the admin client,
-- and the resulting URL's own token is what authorizes the browser's direct PUT — matching the
-- existing `files`/`avatars` buckets' convention (see 20260822090000_files_storage.sql).
insert into storage.buckets (id, name, public, file_size_limit)
values ('document-uploads', 'document-uploads', false, 104857600)
on conflict (id) do nothing;
