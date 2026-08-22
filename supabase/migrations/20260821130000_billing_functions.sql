-- Billing module: atomic usage-limit enforcement and credit-ledger consumption.
-- See docs/SECURITY.md for the rationale behind each function.

-- The initial schema's `unique (owner_type, user_id, organization_id, feature, period)`
-- constraint on usage_counters cannot be relied on for ON CONFLICT upserts: Postgres unique
-- constraints treat NULL as distinct from NULL, so two "user"-owned rows (organization_id always
-- null) for the same user/feature/period would not be recognized as conflicting. Replace it with
-- two partial unique indexes, one per owner type, so ON CONFLICT can target the correct one.
do $$
declare
  legacy_constraint text;
begin
  select conname into legacy_constraint
  from pg_constraint
  where conrelid = 'public.usage_counters'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) ilike '%owner_type%organization_id%feature%period%';

  if legacy_constraint is not null then
    execute format('alter table public.usage_counters drop constraint %I', legacy_constraint);
  end if;
end $$;

create unique index if not exists usage_counters_user_unique_idx
  on public.usage_counters (owner_type, user_id, feature, period)
  where organization_id is null;

create unique index if not exists usage_counters_org_unique_idx
  on public.usage_counters (owner_type, organization_id, feature, period)
  where user_id is null;

create or replace function public.increment_usage_counter(
  p_owner_type public.billing_owner_type,
  p_user_id uuid,
  p_organization_id uuid,
  p_feature text,
  p_period text,
  p_amount integer,
  p_limit integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_quantity integer;
begin
  if p_amount <= 0 then
    raise exception 'Amount to increment must be positive';
  end if;

  if p_amount > p_limit then
    raise exception 'Requested amount % exceeds limit % for feature "%"', p_amount, p_limit, p_feature
      using errcode = 'P0001';
  end if;

  if p_owner_type = 'user' then
    insert into public.usage_counters (owner_type, user_id, organization_id, feature, period, quantity)
    values ('user', p_user_id, null, p_feature, p_period, p_amount)
    on conflict (owner_type, user_id, feature, period) where organization_id is null
    do update set quantity = usage_counters.quantity + excluded.quantity, updated_at = now()
    where usage_counters.quantity + excluded.quantity <= p_limit
    returning quantity into new_quantity;
  else
    insert into public.usage_counters (owner_type, user_id, organization_id, feature, period, quantity)
    values ('organization', null, p_organization_id, p_feature, p_period, p_amount)
    on conflict (owner_type, organization_id, feature, period) where user_id is null
    do update set quantity = usage_counters.quantity + excluded.quantity, updated_at = now()
    where usage_counters.quantity + excluded.quantity <= p_limit
    returning quantity into new_quantity;
  end if;

  if new_quantity is null then
    raise exception 'Usage limit exceeded for feature "%": limit % for period %', p_feature, p_limit, p_period
      using errcode = 'P0001';
  end if;

  return new_quantity;
end;
$$;

create or replace function public.consume_credits(
  p_owner_type public.billing_owner_type,
  p_user_id uuid,
  p_organization_id uuid,
  p_amount integer,
  p_reference text,
  p_metadata jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  lock_key bigint;
  current_balance integer;
begin
  if p_amount <= 0 then
    raise exception 'Amount to consume must be positive';
  end if;

  -- Serialize concurrent consumption for the same owner so the balance check below can't race:
  -- released automatically at the end of this transaction.
  lock_key := hashtextextended(
    concat_ws(':', p_owner_type::text, coalesce(p_user_id::text, ''), coalesce(p_organization_id::text, '')),
    0
  );
  perform pg_advisory_xact_lock(lock_key);

  select coalesce(sum(amount), 0) into current_balance
  from public.credit_transactions
  where owner_type = p_owner_type
    and (
      (p_owner_type = 'user' and user_id = p_user_id)
      or (p_owner_type = 'organization' and organization_id = p_organization_id)
    );

  if current_balance < p_amount then
    raise exception 'Insufficient credit balance: have %, need %', current_balance, p_amount
      using errcode = 'P0001';
  end if;

  insert into public.credit_transactions (
    owner_type, user_id, organization_id, amount, type, reference, metadata, created_by
  )
  values (p_owner_type, p_user_id, p_organization_id, -p_amount, 'usage', p_reference, p_metadata, auth.uid());

  return current_balance - p_amount;
end;
$$;
