# ADR-0001: Native Supabase over Drizzle

## Context

`specs/01-architecture.md`'s technology table states "ORM: Drizzle — matches existing stack."
That's incorrect for the actual boilerplate: there is no ORM anywhere in it. The real stack is
raw SQL migrations applied via the Supabase CLI (`supabase/migrations/*.sql`), the
`@supabase/supabase-js` client, and hand-maintained TypeScript types in
`src/types/database.ts`. Every existing module (`auth`, `organizations`, `billing`, `files`,
`notifications`, `admin`) is written against that client directly. The spec's assumption needed
to be resolved before writing a single migration for Pomočnik's new tables, since Drizzle and
raw-SQL-via-Supabase-CLI are incompatible migration systems — picking one is a one-way door for
every table that follows.

## Decision

Keep the boilerplate's native stack. All new tables (`entity_types`, `entities`, `connections`,
`documents`, `rules`, `import_jobs`, etc.) are added via the same raw-SQL-migration + RLS
convention already established in `supabase/migrations/20260813180000_initial_schema.sql`, and
queried through `@supabase/supabase-js`, following the existing `service.ts` pattern.

## Alternatives considered

- **Introduce Drizzle alongside Supabase.** Rejected: this means maintaining two migration
  systems (Supabase CLI for the auth/storage-managed schema, Drizzle for everything else) or
  migrating the entire existing schema to Drizzle — significant churn with no functional
  benefit, since Supabase CLI + hand-maintained types already satisfy every one of
  `specs/02-data-model.md`'s schema rules (tenant scoping, RLS, indexes, migration policy).
  Drizzle would also duplicate what `supabase gen types` already provides.
- **Drop Supabase entirely, use Drizzle against raw Postgres.** Rejected outright — this throws
  away the boilerplate's working auth (sessions, MFA/AAL2, email verification, invitations),
  RLS-as-security-boundary architecture, and Storage integration, none of which Drizzle
  replaces. Would turn an MVP build into an auth-system rewrite.

## Consequences

- Zero new tooling to learn or maintain; every new table follows a pattern already proven across
  six existing migrations.
- RLS stays the primary security boundary for every new table, consistent with the existing
  `is_organization_member()`/`has_organization_role()` convention — this happens to align well
  with `specs/02-data-model.md`'s explicit requirement that RLS be enabled as defense-in-depth
  on every tenant table.
- No compile-time query type-safety beyond what hand-maintained `src/types/database.ts` provides
  (Drizzle would have offered inferred types from schema definitions) — an accepted tradeoff
  given the type file is already a working, if manual, convention in this codebase.
