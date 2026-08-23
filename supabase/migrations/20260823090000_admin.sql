-- Organization suspension: a suspended org's data becomes invisible to its (non-admin) members
-- everywhere, by teaching the two RLS helper functions every org-scoped policy already routes
-- through. is_app_admin() stays unaffected in every policy, so admins keep full access via the
-- admin client regardless of this flag.
alter table public.organizations add column suspended_at timestamptz;

create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    join public.organizations on organizations.id = organization_members.organization_id
    where organization_members.organization_id = target_organization_id
      and organization_members.user_id = auth.uid()
      and organizations.suspended_at is null
  );
$$;

create or replace function public.has_organization_role(
  target_organization_id uuid,
  allowed_roles public.organization_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    join public.organizations on organizations.id = organization_members.organization_id
    where organization_members.organization_id = target_organization_id
      and organization_members.user_id = auth.uid()
      and organization_members.role = any(allowed_roles)
      and organizations.suspended_at is null
  );
$$;

-- Platform-level subscription override: an in-app entitlement gate that never touches Stripe.
-- getOwnerPlan() filters this out, so a platform-disabled subscription resolves to the "free"
-- plan without cancel_at_period_end or the actual Stripe subscription changing at all.
alter table public.subscriptions add column platform_disabled_at timestamptz;

-- 30-day audit log retention. No scheduler invokes this yet (deliberately deferred) — it exists
-- so a future pg_cron job or admin-triggered route has something to call.
create or replace function public.purge_old_audit_logs()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.audit_logs where created_at < now() - interval '30 days';
$$;
