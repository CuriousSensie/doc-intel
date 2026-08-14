create extension if not exists "pgcrypto";

create type public.organization_role as enum ('owner', 'admin', 'member');
create type public.subscription_status as enum (
  'incomplete',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused'
);
create type public.credit_transaction_type as enum (
  'subscription_grant',
  'purchase',
  'usage',
  'refund',
  'admin_adjustment',
  'promotion'
);
create type public.billing_owner_type as enum ('user', 'organization');
create type public.webhook_processing_status as enum ('pending', 'processed', 'failed');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text,
  avatar_url text,
  timezone text default 'UTC',
  locale text default 'en',
  onboarding_completed boolean not null default false,
  is_app_admin boolean not null default false,
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.organization_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role public.organization_role not null default 'member',
  token_hash text not null unique,
  invited_by uuid references auth.users(id) on delete set null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, email)
);

create table public.stripe_customers (
  id uuid primary key default gen_random_uuid(),
  owner_type public.billing_owner_type not null,
  user_id uuid references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (owner_type = 'user' and user_id is not null and organization_id is null)
    or
    (owner_type = 'organization' and organization_id is not null and user_id is null)
  )
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_type public.billing_owner_type not null,
  user_id uuid references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text unique,
  stripe_price_id text,
  plan_key text not null,
  status public.subscription_status not null default 'incomplete',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (owner_type = 'user' and user_id is not null and organization_id is null)
    or
    (owner_type = 'organization' and organization_id is not null and user_id is null)
  )
);

create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_type public.billing_owner_type not null,
  user_id uuid references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  amount integer not null,
  type public.credit_transaction_type not null,
  reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (amount <> 0),
  check (
    (owner_type = 'user' and user_id is not null and organization_id is null)
    or
    (owner_type = 'organization' and organization_id is not null and user_id is null)
  )
);

create table public.usage_counters (
  id uuid primary key default gen_random_uuid(),
  owner_type public.billing_owner_type not null,
  user_id uuid references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  feature text not null,
  period text not null,
  quantity integer not null default 0,
  reset_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_type, user_id, organization_id, feature, period),
  check (quantity >= 0),
  check (
    (owner_type = 'user' and user_id is not null and organization_id is null)
    or
    (owner_type = 'organization' and organization_id is not null and user_id is null)
  )
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  bucket text not null,
  path text not null,
  filename text not null,
  mime_type text not null,
  size bigint not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (bucket, path),
  check (size > 0)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text not null,
  status public.webhook_processing_status not null default 'pending',
  payload jsonb not null,
  error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, event_id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_email_idx on public.profiles (email);
create index organization_members_user_id_idx on public.organization_members (user_id);
create index organization_members_organization_id_idx on public.organization_members (organization_id);
create index organization_invitations_email_idx on public.organization_invitations (email);
create index subscriptions_user_id_idx on public.subscriptions (user_id);
create index subscriptions_organization_id_idx on public.subscriptions (organization_id);
create index credit_transactions_user_id_idx on public.credit_transactions (user_id);
create index credit_transactions_organization_id_idx on public.credit_transactions (organization_id);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index files_owner_id_idx on public.files (owner_id);
create index files_organization_id_idx on public.files (organization_id);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
create index audit_logs_organization_idx on public.audit_logs (organization_id, created_at desc);
create index projects_owner_id_idx on public.projects (owner_id);
create index projects_organization_id_idx on public.projects (organization_id);

create trigger set_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger set_organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();
create trigger set_organization_members_updated_at before update on public.organization_members
  for each row execute function public.set_updated_at();
create trigger set_organization_invitations_updated_at before update on public.organization_invitations
  for each row execute function public.set_updated_at();
create trigger set_stripe_customers_updated_at before update on public.stripe_customers
  for each row execute function public.set_updated_at();
create trigger set_subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();
create trigger set_usage_counters_updated_at before update on public.usage_counters
  for each row execute function public.set_updated_at();
create trigger set_webhook_events_updated_at before update on public.webhook_events
  for each row execute function public.set_updated_at();
create trigger set_projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_app_admin = true
      and suspended_at is null
  );
$$;

create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = target_organization_id
      and user_id = auth.uid()
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
    where organization_id = target_organization_id
      and user_id = auth.uid()
      and role = any(allowed_roles)
  );
$$;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.stripe_customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.usage_counters enable row level security;
alter table public.notifications enable row level security;
alter table public.files enable row level security;
alter table public.audit_logs enable row level security;
alter table public.webhook_events enable row level security;
alter table public.projects enable row level security;

create policy "profiles_select_own_or_admin" on public.profiles
  for select using (id = auth.uid() or public.is_app_admin());
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy "organizations_select_members_or_admin" on public.organizations
  for select using (public.is_organization_member(id) or public.is_app_admin());
create policy "organizations_insert_authenticated" on public.organizations
  for insert with check (created_by = auth.uid());
create policy "organizations_update_owner_admin" on public.organizations
  for update using (public.has_organization_role(id, array['owner','admin']::public.organization_role[]) or public.is_app_admin());

create policy "organization_members_select_members_or_admin" on public.organization_members
  for select using (public.is_organization_member(organization_id) or public.is_app_admin());
create policy "organization_members_manage_owner_admin" on public.organization_members
  for all using (public.has_organization_role(organization_id, array['owner','admin']::public.organization_role[]) or public.is_app_admin());

create policy "organization_invitations_select_admins" on public.organization_invitations
  for select using (public.has_organization_role(organization_id, array['owner','admin']::public.organization_role[]) or public.is_app_admin());
create policy "organization_invitations_manage_admins" on public.organization_invitations
  for all using (public.has_organization_role(organization_id, array['owner','admin']::public.organization_role[]) or public.is_app_admin());

create policy "stripe_customers_select_owner_or_admin" on public.stripe_customers
  for select using (
    (owner_type = 'user' and user_id = auth.uid())
    or (owner_type = 'organization' and public.has_organization_role(organization_id, array['owner','admin']::public.organization_role[]))
    or public.is_app_admin()
  );

create policy "subscriptions_select_owner_or_admin" on public.subscriptions
  for select using (
    (owner_type = 'user' and user_id = auth.uid())
    or (owner_type = 'organization' and public.is_organization_member(organization_id))
    or public.is_app_admin()
  );

create policy "credit_transactions_select_owner_or_admin" on public.credit_transactions
  for select using (
    (owner_type = 'user' and user_id = auth.uid())
    or (owner_type = 'organization' and public.is_organization_member(organization_id))
    or public.is_app_admin()
  );

create policy "usage_counters_select_owner_or_admin" on public.usage_counters
  for select using (
    (owner_type = 'user' and user_id = auth.uid())
    or (owner_type = 'organization' and public.is_organization_member(organization_id))
    or public.is_app_admin()
  );

create policy "notifications_select_own" on public.notifications
  for select using (user_id = auth.uid() or public.is_app_admin());
create policy "notifications_update_own" on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "files_select_owner_member_or_admin" on public.files
  for select using (
    owner_id = auth.uid()
    or public.is_organization_member(organization_id)
    or public.is_app_admin()
  );

create policy "files_insert_owner" on public.files
  for insert with check (
    owner_id = auth.uid()
    and (organization_id is null or public.is_organization_member(organization_id))
  );

create policy "files_delete_owner_admin" on public.files
  for delete using (
    owner_id = auth.uid()
    or public.has_organization_role(organization_id, array['owner','admin']::public.organization_role[])
    or public.is_app_admin()
  );

create policy "audit_logs_select_admins" on public.audit_logs
  for select using (
    public.is_app_admin()
    or (organization_id is not null and public.has_organization_role(organization_id, array['owner','admin']::public.organization_role[]))
  );

create policy "projects_select_owner_member_or_admin" on public.projects
  for select using (
    owner_id = auth.uid()
    or public.is_organization_member(organization_id)
    or public.is_app_admin()
  );

create policy "projects_insert_owner" on public.projects
  for insert with check (
    owner_id = auth.uid()
    and (organization_id is null or public.is_organization_member(organization_id))
  );

create policy "projects_update_owner_org_admin" on public.projects
  for update using (
    owner_id = auth.uid()
    or public.has_organization_role(organization_id, array['owner','admin']::public.organization_role[])
    or public.is_app_admin()
  );

create policy "projects_delete_owner_org_admin" on public.projects
  for delete using (
    owner_id = auth.uid()
    or public.has_organization_role(organization_id, array['owner','admin']::public.organization_role[])
    or public.is_app_admin()
  );

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
