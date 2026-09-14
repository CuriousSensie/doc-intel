-- Milestone 7 bulk-connect (specs/05-level-1-structure.md §Bulk business actions) tags every
-- connection it creates with created_via = 'bulk' so it's distinguishable from a manual click
-- in history/audit — 'manual' would misrepresent a 500-document batch as 500 individual clicks.
alter table public.connections drop constraint connections_created_via_check;
alter table public.connections add constraint connections_created_via_check
  check (created_via in ('manual', 'rule', 'import', 'template', 'ai_accepted', 'bulk'));
