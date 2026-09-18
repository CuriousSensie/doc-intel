-- Dashboard rebuild (Owner vs. Team Member stats). Replaces the JS-side row-pulling aggregation
-- in dashboard.service.ts's old getOwnerAdminSummary() with real SQL counts, following the same
-- shape as count_document_connections/count_documents_without_connections
-- (20260917120000_documents_numbered_pagination_rpc.sql). Two functions: org-wide totals, and
-- per-member totals (created_by-scoped) reused by both the owner's member-picker and a member's
-- own "My Stats" — tags/correspondents/document types are intentionally excluded from the
-- per-member function since Paperless has no per-user creator attribution for them.

create index if not exists documents_org_created_by_idx
  on public.documents (organization_id, created_by)
  where deleted_at is null;

create index if not exists entities_org_created_by_idx
  on public.entities (organization_id, created_by)
  where deleted_at is null;

create index if not exists connections_org_created_by_idx
  on public.connections (organization_id, created_by)
  where deleted_at is null;

create or replace function public.get_org_dashboard_counts(
  p_organization_id uuid
)
returns table(documents bigint, entities bigint, connections bigint)
language sql
stable
set search_path = public
as $$
  select
    (select count(*) from public.documents d
      where d.organization_id = p_organization_id and d.deleted_at is null),
    (select count(*) from public.entities e
      where e.organization_id = p_organization_id and e.deleted_at is null),
    (select count(*) from public.connections c
      where c.organization_id = p_organization_id and c.deleted_at is null);
$$;

grant execute on function public.get_org_dashboard_counts(uuid) to authenticated;

create or replace function public.get_member_dashboard_counts(
  p_organization_id uuid,
  p_user_id uuid
)
returns table(documents bigint, entities bigint, connections bigint)
language sql
stable
set search_path = public
as $$
  select
    (select count(*) from public.documents d
      where d.organization_id = p_organization_id and d.deleted_at is null
        and d.created_by = p_user_id),
    (select count(*) from public.entities e
      where e.organization_id = p_organization_id and e.deleted_at is null
        and e.created_by = p_user_id),
    (select count(*) from public.connections c
      where c.organization_id = p_organization_id and c.deleted_at is null
        and c.created_by = p_user_id);
$$;

grant execute on function public.get_member_dashboard_counts(uuid, uuid) to authenticated;
