-- ADR-0005: purge_old_audit_logs()'s original 30-day window was sized for admin logs only;
-- business audit (Documenti) requires 2-year retention per specs/10-nonfunctional.md, and a
-- single global window is simpler than a category-split retention policy.
create or replace function public.purge_old_audit_logs()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.audit_logs where created_at < now() - interval '2 years';
$$;
