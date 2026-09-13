-- Removes the boilerplate's generic "files" and "projects" modules entirely — neither is part of
-- Pomočnik's product (Documents/Paperless supersedes files; the `project` entity type, specs/05,
-- supersedes the projects stub). Policies/indexes on both tables drop automatically with the
-- table. public.has_organization_write_access() (introduced alongside the files RLS fix) is kept
-- — it's now load-bearing for entity_types/document_uploads RLS, not files-specific anymore.
drop table if exists public.files;
drop table if exists public.projects;

-- Avatar upload (kept — src/modules/profile/avatar.service.ts) still uses the "avatars" bucket.
-- The files-module-only "files" bucket is deliberately NOT dropped here — Supabase Cloud
-- rejects any direct write to storage.objects/storage.buckets from a migration (SQLSTATE 42501,
-- "use the Storage API instead"), for both the row and its contents. It's left as an orphaned,
-- unreferenced bucket; delete it via the Supabase dashboard or Storage API if it needs to go.
