# ADR-0003: Supabase Cloud (EU region) over self-hosting Supabase

## Context

`specs/01-architecture.md` (D4) locks in a single EU-region host (Docker Compose) running the
Next.js app, worker, Paperless stack, Postgres, Redis, and object storage — explicitly including
Postgres on that host. The boilerplate's auth, RLS, and Storage all depend on the Supabase
platform (GoTrue for sessions/MFA, PostgREST, Storage API), not just "a Postgres database," so
"which Postgres" is really "which Supabase, hosted where." The user has an existing Hostinger
VPS.

This decision was made twice. The first pass (recorded in the now-superseded version of this
ADR) chose self-hosting Supabase's official Docker Compose stack on the Hostinger VPS, reasoning
that it satisfied D4 literally and avoided a recurring external cost. On reflection, the user
chose to revert to Supabase Cloud instead — this ADR records the final decision and why the
self-hosting tradeoff wasn't worth it in practice.

Researched at decision time: Supabase Cloud Pro is $25/month/project (8GB DB, 100GB storage,
overage billed), which is affordable at MVP scale since Pomočnik deliberately never mirrors OCR
text or document bytes into its own database (non-goal in `specs/00-overview.md`) — the business
DB stays lean regardless of document volume. Self-hosting the official Supabase stack (Postgres +
GoTrue + PostgREST + Storage + Kong + Realtime) is zero-cost beyond the VPS itself, but means
owning upgrades for five additional services indefinitely, on top of the Paperless + Gotenberg +
Tika + Celery stack already being self-managed in the same Compose file, on a solo-developer
Hostinger VPS with shared/burstable vCPUs (not dedicated cores).

## Decision

Use Supabase Cloud, EU region (Frankfurt), for the managed Postgres/Auth/Storage layer. No code
changes to any existing auth/org/RLS/files module — the boilerplate already targets Supabase
Cloud by default (`.env.example`'s `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are
cloud-project credentials as shipped). The Hostinger VPS runs everything else: the Next.js app,
the worker, Redis, and the full Paperless stack (webserver, its own Postgres, its own Redis,
Celery OCR workers, Gotenberg, Tika).

## Alternatives considered

- **Self-host the official Supabase Docker Compose stack on the Hostinger VPS** (the original
  decision). Satisfies D4's "everything on one host" literally and has no recurring cost beyond
  the VPS, but the ops burden of running and upgrading GoTrue/PostgREST/Storage/Kong/Realtime
  ourselves — five more services with their own upgrade cadence and failure modes, on top of an
  already-dense single-host stack — outweighed the ~$25–40/month savings for a solo-developer
  MVP. Rejected on reflection.
- **Drop Supabase, hand-roll auth on raw Postgres (self-hosted or managed).** Not seriously
  considered either time — see [ADR-0001](0001-native-supabase-over-drizzle.md); throws away
  weeks of working auth/session/MFA code for no product benefit.

## Consequences

- **Deliberate deviation from D4's literal text** ("Postgres... run on one EU-region Hetzner
  host"): the business database, auth, and file storage now live outside the single-host
  topology. D4's own decision log marks this class of choice reversible, and the deviation is
  scoped narrowly — Paperless (the GPL-boundary-sensitive, OCR-heavy, genuinely stateful part of
  the system) still runs entirely on the Hostinger VPS per D4; only the parts Supabase already
  managed in the boilerplate move to a managed service.
- One fewer category of infrastructure to operate, patch, and back up ourselves — Supabase Cloud
  handles Postgres/GoTrue/PostgREST/Storage upgrades, backups, and point-in-time recovery for
  the business database. The Phase 5 restore drill still covers the Paperless media volume and
  Paperless's own Postgres (self-hosted, our responsibility); Supabase Cloud's own backup/restore
  guarantees cover the business database and are verified against Supabase's documented RPO/RTO
  rather than a runbook we author ourselves.
- Recurring cost (~$25–40/month at MVP scale, reviewed as tenant/document volume grows) in
  exchange for not self-managing five additional services on a shared-vCPU VPS already running
  Paperless's own multi-service stack.
- `infra/docker-compose.yml` is smaller — no `supabase-db`/`supabase-auth`/`supabase-rest`/
  `supabase-storage`/`supabase-kong`/`supabase-realtime` services. The compose file covers
  nginx, the app, the worker, `redis-app`, and the full Paperless stack only.
- EU data residency (GDPR, `specs/10-nonfunctional.md`) is satisfied by selecting Supabase's
  Frankfurt region at project creation — document this choice in `docs/SETUP.md` and
  `docs/subprocessors.md` (Phase 5) since Supabase becomes a named subprocessor.
