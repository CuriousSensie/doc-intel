-- Saved views now distinguish dynamic filter views from fixed document sets. Document ids stay
-- in JSONB to match the existing saved_views columns and because the app always fetches a single
-- view before applying the id list to documents.id.
alter table public.saved_views
  add column view_kind text not null default 'dynamic'
    check (view_kind in ('dynamic', 'static')),
  add column document_ids jsonb not null default '[]'::jsonb
    check (jsonb_typeof(document_ids) = 'array');

alter table public.saved_views
  add constraint saved_views_static_documents_shape check (
    (view_kind = 'dynamic' and document_ids = '[]'::jsonb)
    or view_kind = 'static'
  );
