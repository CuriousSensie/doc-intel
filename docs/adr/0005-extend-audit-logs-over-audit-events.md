# ADR-0005: Extend `audit_logs` over a parallel `audit_events` table

## Context

`specs/02-data-model.md` specifies an `audit_events` table (`actor_type`, `actor_id`, `action`,
`subject_kind`, `subject_id`, `payload`) to record business events: connections, rule
applications, imports, AI acceptance, template generation, permission changes. The boilerplate
already has `audit_logs` (`actor_id`, `organization_id`, `action`, `entity_type`, `entity_id`,
`metadata`), written through a single fan-out function `logEvent()` in `src/lib/events/`, used
today by `auth`, `organizations`, `billing`, `files`, and `admin`. The two tables are
structurally near-identical: `entity_type`/`entity_id` in the existing table are the same concept
as spec's `subject_kind`/`subject_id`; only `actor_type` is genuinely missing.

## Decision

Extend `audit_logs` with an `actor_type text not null default 'user'` column (values: `user |
system | rule | import | ai`) rather than create a second, parallel `audit_events` table.
`logEvent()` stays the single write path for both existing admin/system audit and new Pomočnik
business events.

## Alternatives considered

- **Create `audit_events` as specced, alongside the existing `audit_logs`.** Rejected: two
  audit tables in one system means every reader (the admin audit-log UI, the document/entity
  Activity tab, future exports) has to know which table to query for which event, and
  `logEvent()` would need to route to one or the other — added complexity for a distinction
  (business vs. admin event) that doesn't actually need separate storage, only a queryable
  `actor_type`/`action` namespace, which a single table with the right column already gives.
- **Rename `audit_logs` to `audit_events`.** Considered but not necessary — the name doesn't
  affect behavior, and renaming touches every existing RLS policy and query referencing the
  table for a cosmetic-only change.

## Consequences

- One audit table, one write path, one set of RLS policies to reason about.
- Retention policy must now serve both purposes — see the retention note this decision depends
  on: `purge_old_audit_logs()`'s original 30-day window was sized for admin logs only; it's
  extended to 2 years globally (simpler than a category-split retention policy) since business
  audit requires 2-year retention per `specs/10-nonfunctional.md` and 30 days was an arbitrary
  boilerplate default, not a deliberate constraint worth preserving for a subset of rows.
- `logEvent()`'s existing best-effort, swallow-on-failure sink fan-out is correct for admin/
  supplementary logging but is not sufficient as the *only* record of a required business
  mutation — see ADR-0008 for how business-critical audit rows get a stronger guarantee.
- A reader cross-referencing `specs/02-data-model.md`'s `audit_events` against the codebase needs
  to know it maps to `audit_logs` — recorded in `docs/GLOSSARY.md`.
