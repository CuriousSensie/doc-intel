# ADR-0004: `organization_id` column naming over spec's `org_id`

## Context

`specs/02-data-model.md` names the tenant-scoping column `org_id` on every table (`orgs(id)`,
`org_id uuid not null references orgs(id)`). The boilerplate's existing tenant table is
`organizations`, and every existing table that scopes to it uses `organization_id`
(`organization_members.organization_id`, `files.organization_id`, `audit_logs.organization_id`,
etc.). Every new Pomočnik table needs to pick one convention, and mixing `org_id` on new tables
with `organization_id` on existing ones inside the same schema would be a permanent readability
tax and a source of join bugs.

## Decision

Use `organization_id` on every new table, matching the existing convention. The spec's
underlying *rules* — every tenant-scoped table has this column, not nullable, references the
tenant table, has a leading index, and has an RLS policy in the same migration — are followed
exactly; only the literal column name differs from the spec text.

## Alternatives considered

- **Follow the spec literally (`org_id`).** Rejected: would make every new table inconsistent
  with all six existing tables in the same database, for no benefit beyond spec-text fidelity.
  A future engineer reading the schema would need to remember which half of the tables use which
  name.
- **Rename the existing `organization_id` columns to `org_id`.** Rejected: an unnecessary,
  high-blast-radius migration touching RLS policies, functions (`is_organization_member`,
  `has_organization_role`), and application code across every existing module, purely for naming
  consistency with a spec whose own literal column name was itself just a convention choice, not
  a locked decision (D1–D7 don't mention column naming).

## Consequences

- Every new migration in this build uses `organization_id`; anyone cross-referencing
  `specs/02-data-model.md` against the actual schema needs to know this mapping — recorded in
  `docs/GLOSSARY.md` so it isn't tribal knowledge.
- No functional difference from the spec's intent; this is purely a naming-consistency decision.
