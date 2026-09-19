# Glossary — spec terms → code terms

The product spec (`specs/00-overview.md` through `specs/12-agent-rules.md`) was written before
the boilerplate was audited, and several of its literal names differ from what actually exists
in code (see `docs/adr/` for why each mapping below was chosen over the spec's literal name).
Read this before cross-referencing a spec section against the codebase — a spec table that
mentions `org_id` or `audit_events` is describing the same thing as the code's
`organization_id`/`audit_logs`, not a missing feature.

## Tenancy

| Spec term | Code term | Notes |
|---|---|---|
| `orgs` (table) | `organizations` | Boilerplate's existing table |
| `org_id` (column) | `organization_id` | [ADR-0004](adr/0004-organization-id-column-naming.md) |
| `users` (table) | `auth.users` + `profiles` | Supabase-managed `auth.users`, 1:1 with `public.profiles` |
| `memberships` (table) | `organization_members` | |
| `roles` | `organization_role` enum (`owner \| admin \| member \| read-only`) | 4th role added in Phase 1 |
| `subscriptions` (table) | `subscriptions` | Already matches — owner-polymorphic (user or org), see `docs/DATABASE.md` |
| `notifications` (table) | `notifications` | Already matches |

## Audit

| Spec term | Code term | Notes |
|---|---|---|
| `audit_events` (table) | `audit_logs` | [ADR-0005](adr/0005-extend-audit-logs-over-audit-events.md) |
| `subject_kind` / `subject_id` | `entity_type` / `entity_id` | Same concept, existing column names kept |
| `actor_type` | `actor_type` | New column added to `audit_logs`, matches spec |

## Infrastructure

| Spec term | Code term | Notes |
|---|---|---|
| ORM: Drizzle | None — Supabase-JS + raw SQL migrations | [ADR-0001](adr/0001-native-supabase-over-drizzle.md) |
| `apps/web`, `apps/worker`, `packages/*` monorepo | Single repo; `src/` (app) + `worker/` (worker) | [ADR-0002](adr/0002-single-repo-worker-entrypoint.md) |
| `documenti-infra` (separate repo) | `infra/` (inside the main repo) | [ADR-0002](adr/0002-single-repo-worker-entrypoint.md) |
| Postgres (unspecified hosting) | Supabase Cloud (EU/Frankfurt region) | [ADR-0003](adr/0003-supabase-cloud-over-self-hosted.md) |
| S3-compatible object storage | Supabase Cloud Storage (EU/Frankfurt region) | [ADR-0003](adr/0003-supabase-cloud-over-self-hosted.md) |
| REST API routes (`specs/03-api.md`) | Server Actions (mutations) + Route Handlers (fetched/polled/webhook endpoints) | [ADR-0009](adr/0009-route-handlers-vs-server-actions.md) |

## Rules engine

| Spec term | Code term | Notes |
|---|---|---|
| Delegation to Paperless workflows | Not implemented in the MVP; all rules evaluate locally | [ADR-0006](adr/0006-disable-paperless-workflow-delegation.md) |
| Backfill undo via `rule_id` | Backfill undo via `rule_backfill_id` (per-execution) | [ADR-0010](adr/0010-per-backfill-undo-scope.md) |

## Module/service conventions

| Spec term | Code term | Notes |
|---|---|---|
| (not in spec — new) | `ServiceContext` | [ADR-0007](adr/0007-service-context-pattern.md) — how service functions run in both request and worker contexts |
| (not in spec — new) | Transactional audit Postgres functions (`create_connection()`, etc.) | [ADR-0008](adr/0008-transactional-audit-writes.md) |
| Error codes `VALIDATION_FAILED`, `NOT_FOUND`, `PAPERLESS_UNAVAILABLE`, etc. (`specs/03-api.md`) | lowercase `validation_error`, `not_found`, `paperless_unavailable`, etc. (`src/lib/errors.ts`'s `AppError.code`) | Casing only — same taxonomy, same HTTP statuses. `AppError` is the boilerplate's existing, already-consistent error system (auth, billing, documents all use it); [ADR-0009](adr/0009-route-handlers-vs-server-actions.md) reuses it rather than introducing a parallel UPPER_SNAKE one. `src/lib/api-response.ts`'s envelope carries `AppError.code` verbatim (lowercase) in `error.code`. |
