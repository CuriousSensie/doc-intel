-- Second real bug found the same live-testing session as 20260920000000: complete_rule_backfill()/
-- fail_rule_backfill() insert audit_logs with actor_type = 'rule_backfill', a value never added
-- to audit_logs_actor_type_check's allowed list (user, system, rule, import, ai) — so completing
-- or failing a backfill always raised a check-constraint violation and the row stayed 'running'
-- forever, even after every document had genuinely been matched and every action applied. Both
-- reuse 'rule' (matching apply_rule_action()'s own actor_type for the same rule-driven-write
-- concept), not a new constraint value, since a backfill is just a bulk-triggered rule run.
create or replace function public.complete_rule_backfill(p_rule_backfill_id uuid, p_organization_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_backfill public.rule_backfills%rowtype;
begin
  update public.rule_backfills
  set status = 'completed', finished_at = now()
  where id = p_rule_backfill_id and organization_id = p_organization_id and status = 'running'
  returning * into v_backfill;

  if not found then return false; end if;

  insert into public.audit_logs (actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata)
  values (
    v_backfill.created_by, 'rule', p_organization_id, 'rule.backfill_completed',
    'rule_backfill', p_rule_backfill_id::text,
    jsonb_build_object('rule_id', v_backfill.rule_id, 'matched_count', v_backfill.matched_count,
      'applied_count', v_backfill.applied_count)
  );
  return true;
end;
$$;

create or replace function public.fail_rule_backfill(p_rule_backfill_id uuid, p_organization_id uuid, p_reason text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_backfill public.rule_backfills%rowtype;
begin
  update public.rule_backfills
  set status = 'failed', finished_at = now()
  where id = p_rule_backfill_id and organization_id = p_organization_id
    and status not in ('completed', 'failed', 'cancelled')
  returning * into v_backfill;

  if not found then return false; end if;

  insert into public.audit_logs (actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata)
  values (
    v_backfill.created_by, 'rule', p_organization_id, 'rule.backfill_failed',
    'rule_backfill', p_rule_backfill_id::text, jsonb_build_object('reason', p_reason)
  );
  return true;
end;
$$;
