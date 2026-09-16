-- Documents listing controls: created-at date filtering and the new sort fields.
-- The no-connections RPC keeps the same public function name/permissions, but its date
-- parameters now filter documents.created_at (inclusive local date range) to match /documents.

create index documents_organization_mime_type_id_idx
  on public.documents (organization_id, mime_type, id)
  where deleted_at is null;

create index documents_organization_byte_size_id_idx
  on public.documents (organization_id, byte_size, id)
  where deleted_at is null;

create index documents_organization_page_count_id_idx
  on public.documents (organization_id, page_count, id)
  where deleted_at is null;

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
    and (p_date_from is null or d.created_at >= p_date_from::timestamptz)
    and (p_date_to is null or d.created_at < (p_date_to + 1)::timestamptz)
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
