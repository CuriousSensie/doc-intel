-- Organization logo upload replaces the old logo_url paste-a-URL field (see plan:
-- organizations/team revamp). Same access pattern as the avatars bucket: public read, all
-- writes go through the service-role admin client, no storage.objects RLS needed.
insert into storage.buckets (id, name, public, file_size_limit)
values ('org-logos', 'org-logos', true, 5242880)
on conflict (id) do nothing;
