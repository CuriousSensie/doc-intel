-- Document visibility: a document is visible only to whoever created it and to the
-- organization's owner — not to every org member as before. Entities/connections/tags/
-- correspondents/document types stay fully org-shared (not part of this change) since they're
-- cross-referenced reference data, not personal documents. Paperless can't help enforce this —
-- every object in Paperless is owned by one shared per-tenant service user/group
-- (src/lib/paperless/client.ts), so its ACL only ever distinguishes tenant vs. tenant, never
-- member vs. member within one org. Every document read/write/bulk-edit path in
-- documents.service.ts resolves its authorizing read through this RLS-scoped table before
-- handing off to the admin client for the actual privileged write, so this one policy change is
-- the entire enforcement surface — see the "Document Visibility Permissions" plan for the full
-- trace of verified call sites.

drop policy if exists "documents_select_member" on public.documents;
create policy "documents_select_member" on public.documents
  for select using (
    (
      public.is_organization_member(organization_id)
      and (
        created_by = auth.uid()
        or public.has_organization_role(organization_id, array['owner']::public.organization_role[])
      )
    )
    or public.is_app_admin()
  );

drop policy if exists "document_uploads_select_member" on public.document_uploads;
create policy "document_uploads_select_member" on public.document_uploads
  for select using (
    (
      public.is_organization_member(organization_id)
      and (
        created_by = auth.uid()
        or public.has_organization_role(organization_id, array['owner']::public.organization_role[])
      )
    )
    or public.is_app_admin()
  );

create index if not exists document_uploads_org_created_by_idx
  on public.document_uploads (organization_id, created_by);
