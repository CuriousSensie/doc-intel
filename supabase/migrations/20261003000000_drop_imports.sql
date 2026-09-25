-- Remove the multi-step imports wizard (specs/06-importer.md). The core document upload/OCR
-- pipeline (validate-upload → submit-upload-to-paperless → sync-paperless-document) is
-- unaffected: imports reached into it only via document_uploads.import_row_id +
-- documents.import_job_id, both removed here.
--
-- The import-sources storage bucket is deliberately left orphaned — Supabase Cloud rejects any
-- direct write to storage.objects/storage.buckets from a migration (same note as
-- 20260913120000_drop_files_and_projects.sql). Delete it via the dashboard/Storage API if needed.

-- 1. Unlink the core tables from the import tables before dropping them.
alter table public.documents
  drop constraint if exists documents_import_job_same_organization_fkey;
drop index if exists public.documents_import_job_idx;
alter table public.documents drop column if exists import_job_id;

alter table public.document_uploads
  drop constraint if exists document_uploads_import_row_same_organization_fkey;
drop index if exists public.document_uploads_import_row_idx;
alter table public.document_uploads
  drop column if exists import_row_id,
  drop column if exists source_archive_key;

-- 2. Narrow documents.source back to its pre-import vocabulary (drop the 'import' value).
alter table public.documents drop constraint if exists documents_source_check;
alter table public.documents
  add constraint documents_source_check
  check (source in ('upload', 'email', 'template'));

-- 3. Drop the import write-primitives and lifecycle functions.
drop function if exists public.bulk_update_import_rows(uuid, uuid, jsonb);
drop function if exists public.increment_import_job_progress(uuid, uuid, integer, integer, integer, integer);
drop function if exists public.claim_import_chunk(uuid, uuid, integer);
drop function if exists public.complete_import_job(uuid, uuid);
drop function if exists public.fail_import_job(uuid, uuid, text);

-- 4. Drop the import tables (import_rows references import_jobs, so it goes first).
drop table if exists public.import_rows;
drop table if exists public.import_mappings;
drop table if exists public.import_jobs;
