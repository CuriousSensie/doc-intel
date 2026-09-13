-- Removes the boilerplate's generic "files" and "projects" modules entirely — neither is part of
-- Pomočnik's product (Documents/Paperless supersedes files; the `project` entity type, specs/05,
-- supersedes the projects stub). Policies/indexes on both tables drop automatically with the
-- table. public.has_organization_write_access() (introduced alongside the files RLS fix) is kept
-- — it's now load-bearing for entity_types/document_uploads RLS, not files-specific anymore.
drop table if exists public.files;
drop table if exists public.projects;

-- Avatar upload (kept — src/modules/profile/avatar.service.ts) still uses the "avatars" bucket;
-- only the files-module-only "files" bucket goes.
delete from storage.objects where bucket_id = 'files';
delete from storage.buckets where id = 'files';
