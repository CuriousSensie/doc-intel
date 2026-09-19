-- Split out of 20260824000000: Postgres forbids using a newly added enum value in a function
-- body compiled within the same transaction that added it (SQLSTATE 55P04). Must land as its
-- own migration/transaction after the 'read-only' enum value commits.

-- Same as is_organization_member() but excludes read-only — needed because files_insert_owner
-- (the only member-level write policy today) was keyed to plain membership.
create or replace function public.has_organization_write_access(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    join public.organizations on organizations.id = organization_members.organization_id
    where organization_members.organization_id = target_organization_id
      and organization_members.user_id = auth.uid()
      and organization_members.role <> 'read-only'
      and organizations.suspended_at is null
  );
$$;

drop policy "files_insert_owner" on public.files;
create policy "files_insert_owner" on public.files
  for insert with check (
    owner_id = auth.uid()
    and (organization_id is null or public.has_organization_write_access(organization_id))
  );
