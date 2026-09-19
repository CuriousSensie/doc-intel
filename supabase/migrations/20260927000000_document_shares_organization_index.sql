-- document_shares shipped without a leading organization_id index (specs/12 never-do #12, caught by
-- scripts/check-rls-coverage.ts). Idempotent: 20260923000000 now creates it for fresh databases.
create index if not exists document_shares_organization_idx
  on public.document_shares (organization_id);
