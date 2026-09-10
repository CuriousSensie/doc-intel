# Implementation Plan — Running Checklist

This is the living checklist for building Pomočnik (Level 0 + Level 1) on top of this
boilerplate. The authoritative *design* document is the plan approved at the start of this
build (see `docs/adr/` for every significant decision behind it, `docs/SPEC_TRACEABILITY.md` for
spec-section → code mapping, `docs/GLOSSARY.md` for spec-term → code-term mapping). This file
tracks *progress* against that plan, phase by phase, so nothing — especially a deliberately
deferred item — gets silently dropped.

Check an item only when it's actually merged to `main`, not when it's "mostly done."

## Phase 0 — De-risking spike

- [ ] Isolation spike run against the pinned Paperless version; all 20 checks from
      `specs/10-nonfunctional.md` executed manually; workflow-ACL gap written up (already
      confirmed pre-build — see [ADR-0006](adr/0006-disable-paperless-workflow-delegation.md))
- [ ] Event bridge spike (kill-and-recover test)
- [ ] Slovenian OCR spike (č/š/ž fidelity on real scanned invoices)
- [ ] Import throughput spike (~1,000 documents, measured wall time/CPU/contention)
- [ ] Findings written to `docs/spike-findings.md`; any kill-criterion hit escalated before
      Phase 1 starts

## Infra setup

- [ ] `infra/docker-compose.yml` — nginx, web, worker, redis-app, Paperless webserver + its own
      Postgres/Redis, Celery OCR workers (separate containers), Gotenberg, Tika (business
      Postgres/Auth/Storage is Supabase Cloud — not a compose service; see
      [ADR-0003](adr/0003-supabase-cloud-over-self-hosted.md))
- [ ] Supabase Cloud project created (EU/Frankfurt region), `.env`/secrets configured
- [ ] `infra/scripts/notify-pomocnik.sh` (HMAC over body+timestamp, see §7 below)
- [ ] Boots from a clean checkout with one command

## Phase 1 — Level 0 Foundation

- [ ] `docs/adr/0001`–`0010` written (this commit)
- [ ] `docs/GLOSSARY.md`, `docs/SPEC_TRACEABILITY.md` created (this commit)
- [ ] `docs/audit-boilerplate.md` — formal writeup of the boilerplate audit findings
- [ ] Worker process: `worker/index.ts`, `worker/registry.ts`, `worker/queues.ts`,
      `worker/context.ts`, `Dockerfile.worker`
- [ ] `src/lib/service-context.ts` ([ADR-0007](adr/0007-service-context-pattern.md))
- [ ] `src/lib/queue/` (BullMQ wrapper)
- [ ] Migration: orgs extension columns + `read-only` role + `protect_system_columns()` trigger
- [ ] Role rollout: invitation schema/UI, `AssignableRole`, RLS review for `read-only`
- [ ] Migration: `tenant_paperless_config`, `paperless_object_map`
- [ ] `scripts/check-rls-coverage.ts` CI check
- [ ] `src/modules/tenants/` + `worker/jobs/provision-tenant.ts` (idempotent, advisory-locked,
      compensating cleanup)
- [ ] `POST /admin/orgs/:id/reprovision`
- [ ] `src/lib/paperless/` (client, documents, fields, tags, workflows, types, errors) +
      runtime permission-vs-tenant-config validation + ESLint admin-client restriction +
      `resolveTenantForPaperlessDocument()` narrow export
- [ ] Paperless contract tests in CI against a live container
- [ ] `src/modules/documents/` + `document_uploads` table + `document-uploads` Storage bucket
- [ ] `worker/jobs/validate-upload.ts` (MIME re-sniff + ClamAV)
- [ ] `worker/jobs/submit-upload-to-paperless.ts` (task-id persisted, resumable)
- [ ] `worker/jobs/sync-paperless-document.ts` (shared by upload, webhook, reconciliation)
- [ ] `worker/jobs/expire-abandoned-uploads.ts`
- [ ] `src/lib/errors.ts` extended (413/422/502/503)
- [ ] `audit_logs.actor_type` column; retention extended to 2 years
- [ ] Transactional audit Postgres functions ([ADR-0008](adr/0008-transactional-audit-writes.md))
- [ ] `listAuditLogsForSubject()` scoped read
- [ ] `src/app/api/internal/paperless/document-consumed/route.ts` (HMAC body+timestamp, replay
      window, event dedup)
- [ ] `worker/jobs/reconcile-incremental.ts` (5 min, added+modified, full pagination)
- [ ] `worker/jobs/reconcile-full-sweep.ts` (daily, full listing, deletion detection)
- [ ] Search passthrough on `documents.service.ts`
- [ ] `e2e/isolation.spec.ts` — tests 1–8, 17–20
- [ ] `.github/workflows/ci.yml` (lint/typecheck/test/build + Playwright against a real
      Paperless container and a CI-scoped Supabase Cloud/local Supabase test project)
- [ ] `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/MODULES.md`, `docs/SECURITY.md`,
      `docs/SETUP.md` updated
- [ ] **Phase 1 exit criteria met** (see plan §Verification)

## Phase 2 — Level 1 Structure & Connections

- [ ] Migration: `entity_types`, `entities`, `entity_identifiers`, `connections`,
      `custom_field_defs`, `saved_views` (+ `documents` if not already created in Phase 1)
- [ ] `src/modules/entities/` (CRUD, identifier normalization, unit tests)
- [ ] `src/modules/connections/` (`getConnections()` — the one union-query helper)
- [ ] `entity-merge.service.ts` + `merge_entities()` Postgres function
- [ ] Custom-field decision-rule runtime assertion
- [ ] `documents.service.ts` — `listDocuments()` mixed-filter, `getDocument()`,
      `updateDocument()`
- [ ] Dashboard nav entries + feature flags for `documents`/`entities`
- [ ] Routes: `documents/`, `documents/[id]/`, `entities/[typeKey]/`, `entities/[typeKey]/[id]/`,
      `entity-types/`
- [ ] `pdf-viewer.tsx` (sandboxed, no embedded JS)
- [ ] `connections-panel.tsx`
- [ ] Empty/loading/error states on every new page
- [ ] `src/modules/saved-views/`
- [ ] `data-table.tsx` (Paperless-delegated vs. our-DB-filter split)
- [ ] Bulk connect/disconnect (audited transactionally) + bulk edit proxy +
      `worker/jobs/bulk-action.ts`
- [ ] `src/modules/exports/` + `worker/jobs/export.ts` (CSV `;`/`,`, streaming XLSX, batched
      connection resolution)
- [ ] `e2e/isolation.spec.ts` — tests 9, 14, 15, 16 added
- [ ] Docs updated
- [ ] **Phase 2 exit criteria met**

## Phase 3 — Importer

- [ ] Migration: `import_jobs`, `import_rows`, `import_mappings`
- [ ] `src/modules/imports/` — all three kinds (entities, documents, metadata_only)
- [ ] `src/lib/import/parse.ts` (CSV/TSV/XLSX/ZIP, encoding/delimiter sniff, sl-SI parsing,
      unit tests)
- [ ] Full pipeline: analyze → map → validate → review → run → report
- [ ] `worker/jobs/run-import-row.ts` (chunked, per-row transactional, retry, bounded
      outstanding submissions)
- [ ] Pause/resume/cancel/retry-failed
- [ ] Duplicate-file connections-still-applied behavior
- [ ] Per-job completion independent of OCR-queue drain
- [ ] `GET /imports/:id/report`
- [ ] Docs updated
- [ ] **Phase 3 exit criteria met**

## Phase 4 — Rules Engine

- [ ] Migration: `rules`, `rule_runs`, `rule_backfills`
- [ ] `src/modules/rules/` (DSL validation, evaluator, action dispatcher — `ServiceContext`-based)
- [ ] Trigger wiring (`document.ingested/.updated/.connected`, `entity.created`), cascade cap
- [ ] Conflict resolution (first-writer-wins, `skipped_conflict` recorded)
- [ ] `field_provenance` mechanism (reused later by Level 2)
- [ ] `POST /rules/:id/test` condition-trace
- [ ] `src/lib/safe-regex.ts`
- [ ] `reminders` table + `worker/jobs/fire-due-reminders.ts`
- [ ] `worker/jobs/backfill-rule.ts` (dry-run-count, chunked, per-execution undo via
      `rule_backfill_id`)
- [ ] Docs updated
- [ ] **Phase 4 exit criteria met**

## Phase 5 — Hardening

- [ ] Full isolation suite (all 20 tests) green in CI and on staging post-deploy
- [ ] Load test at 50k-document/largest-tenant scale
- [ ] Restore drill — both databases **and** the Paperless media volume — documented, RTO/RPO
      measured
- [ ] Monitoring/alerting live (queue depth, DLQ, OCR backlog, isolation failure, disk, backups)
- [ ] Single-host resource budgets set and measured under concurrent-import load
- [ ] DPA/subprocessor docs, GPL boundary legal review, Slovenian localisation, onboarding flow
- [ ] Docs updated
- [ ] **Phase 5 exit criteria met — MVP ready for first real customer**
