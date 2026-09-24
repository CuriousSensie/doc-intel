-- ADR-0019 Phase D: bulk folder upload resolves each file's destination folder before creating
-- its upload intent — document_uploads needs to carry that choice through to sync-paperless-
-- document.ts, which reads it off this row the same way it already reads import_row_id.
alter table public.document_uploads
  add column folder_id uuid references public.folders(id) on delete set null;
