-- Documenti Level 1 (specs/02-data-model.md, specs/05-level-1-structure.md). entity_types
-- already exists (20260826000000_tenant_provisioning.sql) — this adds entities,
-- entity_identifiers, connections, custom_field_defs, saved_views, and merge_entities().
-- organization_id naming throughout (docs/adr/0004), has_organization_write_access() for write
-- RLS (docs/adr/0007 — excludes read-only).

create table public.entities (
  id             uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type_id uuid not null references public.entity_types(id),
  display_name   text not null,
  status         text not null default 'active' check (status in ('active', 'archived')),
  data           jsonb not null default '{}'::jsonb,
  search_tsv     tsvector generated always as (
                   to_tsvector('simple', coalesce(display_name, ''))
                 ) stored,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index on public.entities (organization_id, entity_type_id) where deleted_at is null;
create index on public.entities using gin (search_tsv);
create index on public.entities using gin (data jsonb_path_ops);

create trigger entities_set_updated_at
  before update on public.entities
  for each row execute function public.set_updated_at();

alter table public.entities enable row level security;

create policy "entities_select_member" on public.entities
  for select using (public.is_organization_member(organization_id) or public.is_app_admin());

create policy "entities_write_member" on public.entities
  for all using (public.has_organization_write_access(organization_id) or public.is_app_admin())
  with check (public.has_organization_write_access(organization_id) or public.is_app_admin());

-- The import matching key (specs/02-data-model.md §Identifiers). `normalized` is what makes
-- "SI 1234 5678" / "si12345678" / "SI-12345678" collide correctly — see
-- src/modules/entities/identifier-normalization.ts for the per-kind rules.
create table public.entity_identifiers (
  id         uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_id  uuid not null references public.entities(id) on delete cascade,
  kind       text not null,
  value      text not null,
  normalized text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, kind, normalized)
);

create index on public.entity_identifiers (organization_id, normalized);
create index on public.entity_identifiers (entity_id);

alter table public.entity_identifiers enable row level security;

create policy "entity_identifiers_select_member" on public.entity_identifiers
  for select using (public.is_organization_member(organization_id) or public.is_app_admin());

create policy "entity_identifiers_write_member" on public.entity_identifiers
  for all using (public.has_organization_write_access(organization_id) or public.is_app_admin())
  with check (public.has_organization_write_access(organization_id) or public.is_app_admin());

-- The core primitive (specs/05-level-1-structure.md §Connections). One row, read from either
-- direction — src/modules/connections/connections.service.ts's getConnections() is the only
-- place direction logic is allowed to live. No FK on source_id/target_id: polymorphic
-- (document | entity), enforced at the app layer by design — specs/02-data-model.md explicitly
-- says not to "fix" this with nullable document_id/entity_id columns.
create table public.connections (
  id           uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_kind  text not null check (source_kind in ('document', 'entity')),
  source_id    uuid not null,
  target_kind  text not null check (target_kind in ('document', 'entity')),
  target_id    uuid not null,
  relation     text not null default 'related'
               check (relation in ('belongs_to', 'issued_to', 'assigned_to', 'part_of', 'related')),
  metadata     jsonb not null default '{}'::jsonb,
  created_by   uuid references public.profiles(id),
  created_via  text not null default 'manual'
               check (created_via in ('manual', 'rule', 'import', 'template', 'ai_accepted')),
  rule_id      uuid,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

-- Prevents a duplicate connection regardless of which side was entered first.
create unique index connections_unique_pair on public.connections (
  organization_id,
  least(source_id, target_id),
  greatest(source_id, target_id),
  relation
) where deleted_at is null;

create index on public.connections (organization_id, source_kind, source_id) where deleted_at is null;
create index on public.connections (organization_id, target_kind, target_id) where deleted_at is null;

alter table public.connections enable row level security;

create policy "connections_select_member" on public.connections
  for select using (public.is_organization_member(organization_id) or public.is_app_admin());

create policy "connections_write_member" on public.connections
  for all using (public.has_organization_write_access(organization_id) or public.is_app_admin())
  with check (public.has_organization_write_access(organization_id) or public.is_app_admin());

-- Mirror of Paperless custom field *definitions* only — never read from Paperless's
-- /api/custom_fields/ directly (it leaks definitions across tenants even with correct
-- owner/set_permissions — docs/spike-findings.md §1 #6, isolation test #6). Entity links must
-- never be stored here as a value; specs/12-agent-rules.md rule 6.
create table public.custom_field_defs (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organizations(id) on delete cascade,
  key                       text not null,
  label                     text not null,
  data_type                 text not null
                            check (data_type in (
                              'string', 'integer', 'float', 'monetary', 'date', 'boolean',
                              'select', 'documentlink', 'url'
                            )),
  options                   jsonb,
  applies_to                text[] not null default '{}',
  paperless_custom_field_id integer,
  is_required               boolean not null default false,
  created_at                timestamptz not null default now(),
  unique (organization_id, key)
);

create index on public.custom_field_defs (organization_id);

alter table public.custom_field_defs enable row level security;

create policy "custom_field_defs_select_member" on public.custom_field_defs
  for select using (public.is_organization_member(organization_id) or public.is_app_admin());

create policy "custom_field_defs_write_member" on public.custom_field_defs
  for all using (public.has_organization_write_access(organization_id) or public.is_app_admin())
  with check (public.has_organization_write_access(organization_id) or public.is_app_admin());

-- Saved filters/columns/sort over documents or entities (specs/05-level-1-structure.md §Tables
-- and saved views). Shared views are readable by any member; personal views are select-own.
create table public.saved_views (
  id             uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name           text not null,
  scope          text not null check (scope in ('documents', 'entities')),
  entity_type_id uuid references public.entity_types(id),
  filters        jsonb not null default '{}'::jsonb,
  columns        jsonb not null default '[]'::jsonb,
  sort           jsonb,
  is_shared      boolean not null default false,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now()
);

create index on public.saved_views (organization_id);

alter table public.saved_views enable row level security;

create policy "saved_views_select_member" on public.saved_views
  for select using (
    (public.is_organization_member(organization_id) and (is_shared or created_by = auth.uid()))
    or public.is_app_admin()
  );

create policy "saved_views_write_member" on public.saved_views
  for all using (
    (public.has_organization_write_access(organization_id) and created_by = auth.uid())
    or public.is_app_admin()
  )
  with check (
    (public.has_organization_write_access(organization_id) and created_by = auth.uid())
    or public.is_app_admin()
  );

-- Moves connections and identifiers from the merged entity to the kept one, soft-deletes the
-- merged entity, and writes one audit row — atomically (ADR-0008: a merge is exactly the kind
-- of mutation that pattern exists for). Security definer, same shape as complete_provisioning();
-- explicit auth.uid() + has_organization_write_access() check since RLS is bypassed here.
create or replace function public.merge_entities(p_keep_id uuid, p_merge_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_merge_organization_id uuid;
begin
  if p_keep_id = p_merge_id then
    raise exception 'Cannot merge an entity into itself';
  end if;

  select organization_id into v_organization_id from public.entities where id = p_keep_id;
  select organization_id into v_merge_organization_id from public.entities where id = p_merge_id;

  if v_organization_id is null or v_merge_organization_id is null then
    raise exception 'Entity not found';
  end if;

  if v_organization_id <> v_merge_organization_id then
    raise exception 'Cannot merge entities across organizations';
  end if;

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not (public.has_organization_write_access(v_organization_id) or public.is_app_admin()) then
    raise exception 'Not authorized to merge entities in this organization';
  end if;

  -- A connection directly between the two entities being merged would become a self-connection
  -- after re-pointing — meaningless, so drop it first rather than let it collide below.
  update public.connections
  set deleted_at = now()
  where deleted_at is null
    and ((source_kind = 'entity' and source_id = p_merge_id and target_kind = 'entity' and target_id = p_keep_id)
      or (source_kind = 'entity' and source_id = p_keep_id and target_kind = 'entity' and target_id = p_merge_id));

  -- Re-point connections referencing the merged entity onto the kept one. A duplicate that
  -- would violate connections_unique_pair is dropped rather than erroring the whole merge —
  -- it means the same connection already exists on the kept entity.
  update public.connections
  set source_id = p_keep_id
  where source_kind = 'entity' and source_id = p_merge_id
    and not exists (
      select 1 from public.connections c2
      where c2.id <> connections.id
        and c2.deleted_at is null
        and least(c2.source_id, c2.target_id) = least(p_keep_id, connections.target_id)
        and greatest(c2.source_id, c2.target_id) = greatest(p_keep_id, connections.target_id)
        and c2.relation = connections.relation
    );

  update public.connections
  set target_id = p_keep_id
  where target_kind = 'entity' and target_id = p_merge_id
    and not exists (
      select 1 from public.connections c2
      where c2.id <> connections.id
        and c2.deleted_at is null
        and least(c2.source_id, c2.target_id) = least(connections.source_id, p_keep_id)
        and greatest(c2.source_id, c2.target_id) = greatest(connections.source_id, p_keep_id)
        and c2.relation = connections.relation
    );

  -- Any connection still pointing at the merged entity at this point is a dropped duplicate;
  -- soft-delete it so it doesn't dangle.
  update public.connections
  set deleted_at = now()
  where deleted_at is null
    and ((source_kind = 'entity' and source_id = p_merge_id)
      or (target_kind = 'entity' and target_id = p_merge_id));

  -- Identifiers: move what doesn't collide, drop what does (already on the kept entity).
  update public.entity_identifiers ei
  set entity_id = p_keep_id
  where ei.entity_id = p_merge_id
    and not exists (
      select 1 from public.entity_identifiers ei2
      where ei2.organization_id = ei.organization_id
        and ei2.kind = ei.kind
        and ei2.normalized = ei.normalized
        and ei2.entity_id = p_keep_id
    );

  delete from public.entity_identifiers where entity_id = p_merge_id;

  update public.entities set status = 'archived', deleted_at = now() where id = p_merge_id;

  insert into public.audit_logs (actor_id, actor_type, organization_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'user', v_organization_id, 'entity.merged', 'entity', p_keep_id::text,
    jsonb_build_object('merged_entity_id', p_merge_id)
  );
end;
$$;
