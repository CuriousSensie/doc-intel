-- Documents list redesign: sort by title / document type, in addition to the existing
-- created_at ordering (already indexed by documents_organization_created_id_idx). Both new sort
-- columns are keyset-paginated the same way (column, id) tiebreaker, so each needs its own
-- composite index to avoid a sort-then-scan at scale.
create index documents_organization_title_id_idx
  on public.documents (organization_id, title, id)
  where deleted_at is null;

create index documents_organization_type_id_idx
  on public.documents (organization_id, document_type_key, id)
  where deleted_at is null;
