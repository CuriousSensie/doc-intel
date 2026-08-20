-- The initial schema defined select/insert/update policies for organizations but no
-- delete policy, so an owner could not delete their own organization under RLS.
create policy "organizations_delete_owner" on public.organizations
  for delete using (
    public.has_organization_role(id, array['owner']::public.organization_role[])
    or public.is_app_admin()
  );
