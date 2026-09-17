-- Documents listing numbered pagination support.
-- Adds exact-count helpers for the no-connections view and a batched aggregate for the
-- per-page connection count column.

create index if not exists documents_organization_type_created_id_idx
  on public.documents (organization_id, document_type_key, created_at desc, id desc)
  where deleted_at is null;

create or replace function public.count_document_connections(
  p_organization_id uuid,
  p_document_ids uuid[]
)
returns table(document_id uuid, connection_count bigint)
language sql
stable
set search_path = public
as $$
  with requested as (
    select unnest(p_document_ids) as document_id
  )
  select
    requested.document_id,
    count(c.id)::bigint as connection_count
  from requested
  left join public.connections c
    on c.organization_id = p_organization_id
   and c.deleted_at is null
   and (
      (c.source_kind = 'document' and c.source_id = requested.document_id)
      or (c.target_kind = 'document' and c.target_id = requested.document_id)
   )
  group by requested.document_id;
$$;

grant execute on function public.count_document_connections(uuid, uuid[]) to authenticated;

create or replace function public.count_documents_without_connections(
  p_organization_id uuid,
  p_document_type_key text default null,
  p_status text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_paperless_ids integer[] default null
)
returns bigint
language sql
stable
set search_path = public
as $$
  select count(*)::bigint
  from public.documents d
  where d.organization_id = p_organization_id
    and d.deleted_at is null
    and (p_document_type_key is null or d.document_type_key = p_document_type_key)
    and (p_status is null or d.status = p_status)
    and (p_date_from is null or d.created_at >= p_date_from::timestamptz)
    and (p_date_to is null or d.created_at < (p_date_to + 1)::timestamptz)
    and (p_paperless_ids is null or d.paperless_document_id = any(p_paperless_ids))
    and not exists (
      select 1
      from public.connections c
      where c.organization_id = d.organization_id
        and c.deleted_at is null
        and (
          (c.source_kind = 'document' and c.source_id = d.id)
          or (c.target_kind = 'document' and c.target_id = d.id)
        )
    );
$$;

grant execute on function public.count_documents_without_connections(
  uuid, text, text, date, date, integer[]
) to authenticated;

create or replace function public.list_documents_without_connections_page(
  p_organization_id uuid,
  p_document_type_key text default null,
  p_status text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_paperless_ids integer[] default null,
  p_sort text default 'created',
  p_sort_direction text default 'desc',
  p_offset integer default 0,
  p_limit integer default 25
)
returns setof public.documents
language plpgsql
stable
set search_path = public
as $$
declare
  sort_column text;
  sort_direction text;
begin
  sort_column := case p_sort
    when 'title' then 'title'
    when 'mimeType' then 'mime_type'
    when 'size' then 'byte_size'
    when 'pages' then 'page_count'
    else 'created_at'
  end;
  sort_direction := case when p_sort_direction = 'asc' then 'asc' else 'desc' end;

  return query execute format(
    'select d.*
     from public.documents d
     where d.organization_id = $1
       and d.deleted_at is null
       and ($2 is null or d.document_type_key = $2)
       and ($3 is null or d.status = $3)
       and ($4 is null or d.created_at >= $4::timestamptz)
       and ($5 is null or d.created_at < ($5 + 1)::timestamptz)
       and ($6 is null or d.paperless_document_id = any($6))
       and not exists (
         select 1
         from public.connections c
         where c.organization_id = d.organization_id
           and c.deleted_at is null
           and (
             (c.source_kind = ''document'' and c.source_id = d.id)
             or (c.target_kind = ''document'' and c.target_id = d.id)
           )
       )
     order by d.%I %s nulls last, d.id %s
     limit $7 offset $8',
    sort_column,
    sort_direction,
    sort_direction
  )
  using
    p_organization_id,
    p_document_type_key,
    p_status,
    p_date_from,
    p_date_to,
    p_paperless_ids,
    greatest(1, least(coalesce(p_limit, 25), 50)),
    greatest(0, coalesce(p_offset, 0));
end;
$$;

grant execute on function public.list_documents_without_connections_page(
  uuid, text, text, date, date, integer[], text, text, integer, integer
) to authenticated;
