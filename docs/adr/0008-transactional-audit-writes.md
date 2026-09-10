# ADR-0008: Transactional audit writes for business-critical mutations

## Context

`specs/12-agent-rules.md` requires: "Write an `audit_events` row for every business-meaningful
mutation" (see ADR-0005 for why this lands in `audit_logs`). The existing write path,
`logEvent()` in `src/lib/events/index.ts`, fans an event out to a list of sinks
(`consoleSink`, `auditLogSink`) and **deliberately swallows sink failures** — its own doc
comment states this is "so it can never block the mutation that triggered it." That's the right
behavior for optional, supplementary logging (which is what it was built for — admin
observability). It is the wrong behavior for a record the spec calls a hard requirement: if the
`auditLogSink` write fails after `logEvent()` already returned successfully having logged to
console, the calling mutation still reports success, and the required audit trail silently has a
gap.

## Decision

For the specific set of mutations the spec designates as requiring a guaranteed audit record —
connection create/delete, rule action application, import completion, AI run acceptance,
tenant provisioning outcome, permission changes — the audit row is written **inside the same
Postgres transaction/function as the mutation itself**, via dedicated `plpgsql` functions (e.g.
`create_connection()`, `delete_connection()`, `apply_rule_action()`, `complete_provisioning()`)
that insert both the domain row and the audit row atomically, following the same RPC pattern the
boilerplate already uses for `create_organization()`. `logEvent()`'s fan-out continues to run
alongside this for the supplementary sinks (console today; Slack/analytics later) — it is not
replaced, only no longer relied on as the sole record for this specific set of mutations.

## Alternatives considered

- **Rely on `logEvent()` alone, as originally implied by reusing existing infrastructure.**
  Rejected once the failure mode was traced through: a sink failure is silent by design, which
  is correct for its original purpose but violates the spec's "every business-meaningful
  mutation" guarantee the moment any sink hiccups.
- **Wrap every mutation + `logEvent()` call in an application-level transaction from
  TypeScript.** Rejected: `@supabase/supabase-js` doesn't expose multi-statement transactions
  over PostgREST in a way that spans an arbitrary service-layer function; the only reliable way
  to guarantee atomicity between a domain write and its audit row is a single Postgres function
  call, which is also how the boilerplate already solves an analogous problem
  (`create_organization()` creating both the org and the creator's membership atomically).
- **A generic outbox table + a relay worker guaranteeing eventual delivery to `audit_logs`.**
  Considered as the "more correct" distributed-systems answer, but rejected as overkill here:
  the domain write and its audit row live in the *same* database, so a same-transaction insert
  is simpler and equally reliable — an outbox pattern earns its complexity when the audit
  destination is a different system, which isn't the case.

## Consequences

- A small, fixed list of new Postgres functions (not a general "every service call becomes an
  RPC" rule) for the mutations that specifically need this guarantee — most reads and
  lower-stakes writes still go through plain `service.ts` functions.
- `logEvent()` remains as-is, unmodified, for every other use across the codebase (auth events,
  billing events, admin actions) — this decision doesn't change its existing contract or
  callers.
- Every new Postgres function added under this ADR is `security definer` with `search_path`
  explicitly set, matching the existing convention for `is_app_admin()`,
  `create_organization()`, etc., documented in `docs/DATABASE.md`'s Functions table as each one
  is added.
