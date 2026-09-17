-- Phase 3 M7: query gaps a real import exposes immediately at 10k+ documents.
--
-- 1. listDocuments()'s keyset cursor orders by (created_at desc, id desc) with no matching
--    index — every list page was a full-table scan-then-sort for the org.
-- 2. The status filter (used by every saved view except "All documents") had no index pairing
--    it with the same ordering.
create index documents_organization_created_id_idx
  on public.documents (organization_id, created_at desc, id desc)
  where deleted_at is null;

create index documents_organization_status_created_idx
  on public.documents (organization_id, status, created_at desc)
  where deleted_at is null;

-- 3. "Documents with no connections" (specs/05-level-1-structure.md's workhorse view — how a
--    tenant works through an import backlog) used to pull every connection row for the org into
--    Node memory to build a `NOT IN (id, id, id, ...)` string — the exact anti-pattern
--    specs/10-nonfunctional.md calls out ("cap the Paperless id set and paginate carefully...
--    this is the one place naive implementation will not scale"). A 10k-document import with
--    even a modest fraction of connected documents already produces a multi-thousand-entry
--    NOT IN list on every single page of every request.
--
-- This does the whole filtered, paginated query in one indexed statement instead: the same
-- filter set listDocuments() applies in application code, plus a NOT EXISTS against
-- `connections` — using the two partial indexes that migration already created
-- (connections (organization_id, source_kind, source_id) / (organization_id, target_kind,
-- target_id), both `where deleted_at is null`) rather than a full scan.
create or replace function public.list_documents_without_connections(
  p_organization_id uuid,
  p_document_type_key text default null,
  p_status text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_paperless_ids integer[] default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 25
)
returns setof public.documents
language sql
stable
set search_path = public
as $$
  select d.*
  from public.documents d
  where d.organization_id = p_organization_id
    and d.deleted_at is null
    and (p_document_type_key is null or d.document_type_key = p_document_type_key)
    and (p_status is null or d.status = p_status)
    and (p_date_from is null or d.document_date >= p_date_from)
    and (p_date_to is null or d.document_date <= p_date_to)
    and (p_paperless_ids is null or d.paperless_document_id = any(p_paperless_ids))
    and (
      p_cursor_created_at is null
      or d.created_at < p_cursor_created_at
      or (d.created_at = p_cursor_created_at and d.id < p_cursor_id)
    )
    and not exists (
      select 1 from public.connections c
      where c.organization_id = d.organization_id
        and c.deleted_at is null
        and (
          (c.source_kind = 'document' and c.source_id = d.id)
          or (c.target_kind = 'document' and c.target_id = d.id)
        )
    )
  order by d.created_at desc, d.id desc
  limit p_limit;
$$;

-- Read-only, same exposure as any other member-facing query — RLS on `documents` itself
-- (documents_select_member) already scopes what a caller's own client can request; this
-- function only changes how the WHERE clause is expressed, not who can call it. Granted to
-- authenticated (not just service_role) since listDocuments() runs under the caller's own
-- RLS-scoped client, not the admin client.
grant execute on function public.list_documents_without_connections(
  uuid, text, text, date, date, integer[], timestamptz, uuid, integer
) to authenticated;
