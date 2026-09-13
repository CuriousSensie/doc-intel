# Architecture Decision Records

This directory records every significant, debatable decision made while building Pomočnik on
top of this boilerplate — not what the code does (that's `docs/ARCHITECTURE.md`,
`docs/DATABASE.md`, `docs/MODULES.md`), but *why it was built this way and not another way*.

## Why this exists

The product spec (`specs/00-overview.md` through `specs/12-agent-rules.md`) describes the
target system, but it was written assuming a different tech stack than this boilerplate
actually is, and implementation surfaces new forks in the road constantly. Every time someone
picks one path over a real alternative — not just fills in an unambiguous blank — that decision
gets an ADR. The bar: if a future maintainer could reasonably ask "why didn't we just do X
instead," the answer belongs here, not in a commit message or a Slack thread.

## Format

Each ADR is short: **Context** (the problem/question that forced a decision) → **Decision**
(what we chose) → **Alternatives considered** (what else was on the table and why it lost) →
**Consequences** (what this makes easier, harder, or forecloses).

ADRs are numbered sequentially and never renumbered or deleted. A superseded decision gets a new
ADR that says so and links back; the old one stays as a record of what was true at the time.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-native-supabase-over-drizzle.md) | Native Supabase over Drizzle | Accepted |
| [0002](0002-single-repo-worker-entrypoint.md) | Single repo + worker entrypoint over a monorepo | Accepted |
| [0003](0003-supabase-cloud-over-self-hosted.md) | Supabase Cloud (EU region) over self-hosting Supabase | Accepted |
| [0004](0004-organization-id-column-naming.md) | `organization_id` column naming over spec's `org_id` | Accepted |
| [0005](0005-extend-audit-logs-over-audit-events.md) | Extend `audit_logs` over a parallel `audit_events` table | Accepted |
| [0006](0006-disable-paperless-workflow-delegation.md) | Disable Paperless workflow delegation for the MVP | Accepted |
| [0007](0007-service-context-pattern.md) | `ServiceContext` pattern for request/worker-shared service functions | Accepted |
| [0008](0008-transactional-audit-writes.md) | Transactional audit writes for business-critical mutations | Accepted |
| [0009](0009-route-handlers-vs-server-actions.md) | Route Handlers vs. Server Actions allocation for the REST contract | Accepted |
| [0010](0010-per-backfill-undo-scope.md) | Per-backfill-execution undo scope instead of per-rule undo | Accepted |
| [0011](0011-decline-mistral-ocr-pipeline.md) | Decline a Mistral OCR/LLM document pipeline for now | Accepted |
| [0012](0012-clamav-scan-service.md) | `clamd` over TCP for the upload AV scan | Accepted |
| [0013](0013-defer-middleware-page-auth-dedup.md) | Defer deduplicating middleware/page session verification | Deferred |
