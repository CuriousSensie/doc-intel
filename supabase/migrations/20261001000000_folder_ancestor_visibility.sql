-- ADR-0019 follow-up: a member granted access to a leaf folder (e.g. /Invoices/Sept) could not
-- see the "Invoices" row at all — folders_select_member only ever looked at a grant on the folder
-- itself or one of its descendants (can_access_folder's cascade), never at a grant on a
-- descendant looking back up. Every path/breadcrumb built by walking parentFolderId over the
-- RLS-scoped folder list therefore silently truncated at the first missing ancestor, showing
-- "/Sept" instead of "/Invoices/Sept" — the stored path itself was always correct, this was a
-- pure visibility gap. This function only widens folders_select_member (name/path visible for
-- breadcrumb purposes); it is deliberately never used by can_access_folder,
-- can_access_document_via_folder, documents_select_member, filter_folder_ids, or any write RPC —
-- an ancestor made visible this way must not become readable-for-its-own-documents or
-- manageable/grantable by this member.
create or replace function public.can_view_folder_as_ancestor(p_folder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.folder_access fa
    join public.folders h on h.id = fa.folder_id and h.deleted_at is null
    where fa.granted_to = auth.uid()
      and p_folder_id = any(h.path_ids)
  );
$$;

grant execute on function public.can_view_folder_as_ancestor(uuid) to authenticated;

drop policy if exists "folders_select_member" on public.folders;
create policy "folders_select_member" on public.folders
  for select using (
    (
      public.is_organization_member(organization_id)
      and (
        created_by = auth.uid()
        or public.has_organization_role(organization_id, array['owner','admin']::public.organization_role[])
        or public.can_access_folder(id, 'view')
        or public.can_view_folder_as_ancestor(id)
      )
    )
    or public.is_app_admin()
  );
