# ADR-0010: Per-backfill-execution undo scope instead of per-rule undo

## Context

`specs/07-rules-engine.md` requires rule backfills to be reversible: "Backfill without undo is
how a tenant destroys their data with one bad rule. Undo is a requirement, not a nicety." The
spec's stated mechanism is that `connections.created_via = 'rule'` plus `rule_id` "makes bulk
undo possible" — implying undo works by deleting every connection matching that `rule_id`. On
inspection this is broader than what "undo my backfill" should mean: a single rule can match and
create connections both through **normal ingestion-triggered runs** (every time a matching
document is ingested, ongoing) and through **one specific backfill run** (a one-time bulk
application to existing documents, per `POST /rules/:id/backfill`). Both write
`created_via='rule'` with the same `rule_id`. Undoing by `rule_id` alone would delete every
connection that rule has ever created, including ones from normal day-to-day ingestion that have
nothing to do with the backfill the user is trying to reverse — a correctness bug hiding inside
a feature whose entire purpose is safety.

## Decision

Add a `rule_backfills` table — one row per `POST /rules/:id/backfill` execution. Every connection
created during a specific backfill run is tagged with that run's id (`rule_backfill_id`) in
addition to the existing `rule_id`. Undo (`POST /rule-backfills/:id/undo` or equivalent) deletes
only connections matching that specific `rule_backfill_id` — never a bare `rule_id` match.

## Alternatives considered

- **Undo by `rule_id` as the spec literally describes.** Rejected: demonstrably deletes more
  than the user asked to undo the moment the same rule has also matched through normal
  ingestion, which is the common case for any rule left enabled after its backfill runs.
- **Disable the rule during backfill so `rule_id` matches are unambiguous, then re-enable.**
  Rejected: this either blocks normal ingestion processing for the whole tenant during the
  backfill (unacceptable on a shared instance where other tenants' unrelated documents are
  ingesting concurrently) or requires the same disambiguation this ADR already solves more
  simply with an explicit run id.

## Consequences

- One additional small table (`rule_backfills`: id, `rule_id`, `organization_id`, `status`,
  `matched_count`, `applied_count`, timestamps) and one additional foreign key column on
  `connections`.
- `POST /rules/:id/backfill`'s existing requirement (dry-run count first, chunked, pausable,
  fully audited) is unchanged — this ADR only sharpens what "undo" actually reverses.
- Normal ingestion-triggered rule matches remain permanently undoable only by deleting the
  specific connection by hand (or via entity/document UI), which is correct: there is no
  "backfill run" to point undo at for those, and spec never asked for bulk-undo of ordinary
  ingestion — only of backfills.
