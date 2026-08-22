-- Storage buckets for the files module. All bucket access (upload, delete, signed URLs) goes
-- through the service-role admin client from server code, matching the table's own
-- select/insert/delete-only RLS (no update policy) — see docs/SECURITY.md. No storage.objects RLS
-- policies are added because nothing ever accesses these buckets directly from the browser.
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('avatars', 'avatars', true, 5242880),
  ('files', 'files', false, 20971520)
on conflict (id) do nothing;

-- The existing files_owner_id_idx/files_organization_id_idx indexes don't help the
-- created_at-desc cursor pagination used by listFiles(); add composite indexes matching the
-- (owner_id | organization_id, created_at desc) query shapes, same idea as
-- notifications_user_created_idx.
create index files_owner_created_idx on public.files (owner_id, created_at desc, id desc);
create index files_organization_created_idx on public.files (organization_id, created_at desc, id desc)
  where organization_id is not null;
