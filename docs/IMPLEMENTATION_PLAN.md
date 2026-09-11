# Implementation Plan — Running Checklist

This is the living checklist for building Pomočnik (Level 0 + Level 1) on top of this
boilerplate. The authoritative *design* document is the plan approved at the start of this
build (see `docs/adr/` for every significant decision behind it, `docs/SPEC_TRACEABILITY.md` for
spec-section → code mapping, `docs/GLOSSARY.md` for spec-term → code-term mapping). This file
tracks *progress* against that plan, phase by phase, so nothing — especially a deliberately
deferred item — gets silently dropped.

Check an item only when it's actually merged to `main`, not when it's "mostly done."

## Phase 0 — De-risking spike

- [x] Isolation spike run against the pinned Paperless version (13 of 20 checks — the subset
      not needing Level 1+ primitives — actually executed against a live instance); workflow-ACL
      gap empirically confirmed (see [ADR-0006](adr/0006-disable-paperless-workflow-delegation.md)).
      **2 real findings**: custom field definitions leak across tenants (#6, contained by
      always querying our own mirror, never Paperless's list endpoint); cross-tenant document
      download returns 403 not 404 (#8, confirms the error-mapping layer is load-bearing, not
      optional). See `docs/spike-findings.md` §1.
- [ ] Event bridge spike — mechanism confirmed (script executes, env vars propagate,
      container-to-container networking works), but end-to-end webhook delivery and the
      kill-and-recover test are still unverified (sandbox-specific container→host network
      restriction blocked the throwaway listener test — not expected to reproduce once `web`
      is a compose service). Re-run once the real webhook route exists (Phase 1 §7).
- [ ] Slovenian OCR spike — `tesseract-ocr-slv` confirmed present in the pinned image and
      configured correctly; **actual recognition fidelity on a real scan is untested — needs
      the user to supply real/representative Slovenian scanned invoices.** Blocking item.
- [ ] Import throughput spike — ran at reduced scale (100 synthetic documents, not 1,000 real
      scanned ones) due to this session's sandbox constraints; confirmed OCR backlog is real
      even at trivial scale. Full-scale run deferred to Phase 5's load test on the real VPS.
- [x] Findings written to `docs/spike-findings.md`. **No kill-criterion was hit** — proceeding
      to Phase 1 with all findings above carried forward as tracked implementation
      requirements (see the additions below), not assumptions.

## Infra setup

- [x] `infra/docker-compose.yml` — nginx, web, worker, redis-app, Paperless webserver + its own
      Postgres/Redis, Gotenberg, Tika (business Postgres/Auth/Storage is Supabase Cloud — not a
      compose service; see [ADR-0003](adr/0003-supabase-cloud-over-self-hosted.md)). **Deviation
      from D4**: the separate Celery OCR worker container is defined but disabled — it
      crash-loops on the pinned 3.1.3 image (see `docs/spike-findings.md` §0); webserver runs
      in Paperless's default all-in-one mode until root-caused.
- [ ] Supabase Cloud project created (EU/Frankfurt region), `.env`/secrets configured — not
      done this session (no live Supabase project provisioned; local infra work used only the
      Paperless side)
- [x] `infra/scripts/notify-pomocnik.sh` (HMAC over body+timestamp) — confirmed executing
      correctly against a live instance (exits 0, correct env vars), end-to-end delivery still
      pending per the event-bridge spike note above
- [x] Boots from a clean checkout with one command (`docker compose --profile paperless up -d`
      verified end-to-end this session, including fixing `PAPERLESS_SECRET_KEY` being
      undocumented and `host.docker.internal` not resolving on Linux — both fixed in the
      compose file/`.env.example`)

## Phase 1 — Level 0 Foundation

- [x] `docs/adr/0001`–`0010` written
- [x] `docs/GLOSSARY.md`, `docs/SPEC_TRACEABILITY.md` created
- [ ] `docs/audit-boilerplate.md` — formal writeup of the boilerplate audit findings (this
      session's audit findings are captured in the ADRs and `docs/spike-findings.md`, but the
      standalone doc `specs/04-level-0-foundation.md` asks for hasn't been written yet)
- [x] Worker process: `worker/index.ts`, `worker/registry.ts`, `worker/queues.ts`,
      `worker/context.ts`, `Dockerfile.worker` — scaffolded and confirmed booting (real BullMQ
      Workers start, path aliases resolve via `tsx`); job handlers are still honest
      placeholders pending the items below
- [x] `src/lib/service-context.ts` ([ADR-0007](adr/0007-service-context-pattern.md))
- [x] `src/lib/queue/` (BullMQ wrapper)
- [x] Migration: orgs extension columns + `read-only` role + `protect_system_columns()` trigger
      (`supabase/migrations/20260824000000_pomocnik_orgs_extension.sql`) — also added
      `has_organization_write_access()` and repointed `files_insert_owner` at it (a fresh
      `read-only` member would otherwise still have been able to upload files via the existing
      `is_organization_member()`-keyed policy). Verified end-to-end against a throwaway Postgres
      container with `auth`/`storage` stubbed: enum value present, trigger blocks a
      non-service-role write to `provisioning_status`/`ai_enabled` and allows a normal column
      update, `has_organization_write_access()` returns false for `read-only` / true for
      `member`. No live Supabase project exists yet this session to run it through the real CLI.
- [x] Role rollout: `src/types/database.ts` (enum + new `organizations` columns, 8 occurrences),
      `organizations.schemas.ts`'s `assignableRole` Zod enum (+ test), `can()` in
      `authorization.ts`, the invite-role `<select>` and per-member role control on
      `/settings/team` (was a binary admin/member toggle button — now a 3-option select, since a
      toggle doesn't generalize past two roles)
- [x] Migration: `tenant_paperless_config`, `paperless_object_map`
      (`supabase/migrations/20260825000000_paperless_linkage.sql`) — both RLS-enabled with zero
      policies (admin-client only, matching `stripe_customers`/`subscriptions`/`webhook_events`).
      Verified end-to-end against a throwaway Postgres container: RLS + 0 policies confirmed,
      the `(object_type, paperless_id)` unique constraint rejects a cross-tenant duplicate, the
      `object_type` check constraint rejects an invalid value.
- [x] `scripts/check-rls-coverage.ts` CI check — verified against both a real violation (catches
      it) and the existing schema (passes). Extended twice this session: to recognize
      `organization_id uuid primary key` as satisfying the leading-index requirement, and to
      accept an explicit `-- rls-coverage: admin-only (no policies)` marker for tables that are
      deliberately RLS-enabled with zero policies — both re-verified against the same real
      violation + passing-schema regression check.
- [ ] `src/modules/tenants/` + `worker/jobs/provision-tenant.ts` (idempotent, advisory-locked,
      compensating cleanup). **Must grant `TENANT_MODEL_PERMISSIONS`-equivalent Django group
      permissions** (add/change/delete/view for tag, document, documenttype, correspondent,
      storagepath, customfield, customfieldinstance, savedview, savedviewfilterrule, note,
      paperlesstask, workflow, workflowtrigger, workflowaction — bare `codename`, not
      `app_label.codename`) **in addition to** per-object `set_permissions` — confirmed via the
      Phase 0 isolation spike that a fresh Paperless group has zero permissions by default and
      the tenant service user cannot create anything without this. See
      `scripts/spike/lib/paperless-admin.ts` and `docs/spike-findings.md` §1.
- [ ] `POST /admin/orgs/:id/reprovision`
- [ ] `src/lib/paperless/` (client, documents, fields, tags, workflows, types, errors) +
      runtime permission-vs-tenant-config validation + ESLint admin-client restriction +
      `resolveTenantForPaperlessDocument()` narrow export. **`errors.ts` must translate a
      Paperless 403 on any tenant-scoped read into our `NOT_FOUND` (404)** — confirmed via the
      Phase 0 isolation spike that Paperless returns 403 (not 404) for cross-tenant document
      access, which `specs/03-api.md` explicitly forbids exposing. See `docs/spike-findings.md`
      §1 (#8).
- [ ] Paperless contract tests in CI against a live container — `.github/workflows/ci.yml`
      already wires this up (`continue-on-error` until `src/lib/paperless` exists)
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
- [ ] `e2e/isolation.spec.ts` — tests 1–8, 17–20 (the raw checks were run manually as
      `scripts/spike/isolation.ts` this session — 9 of these 11 passed live against a real
      instance; #6 and #8's equivalents failed and are tracked above, not silently dropped;
      lifting these into real Playwright specs is still open)
- [x] `.github/workflows/ci.yml` (lint/typecheck/test/build + Playwright against a real
      Paperless container and a CI-scoped Supabase Cloud/local Supabase test project) — written;
      not yet run in actual GitHub Actions (no push to a remote this session)
- [ ] `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/MODULES.md`, `docs/SECURITY.md`,
      `docs/SETUP.md` updated
- [ ] **Phase 1 exit criteria met** (see plan §Verification)

## Phase 2 — Level 1 Structure & Connections

- [ ] Migration: `entity_types`, `entities`, `entity_identifiers`, `connections`,
      `custom_field_defs`, `saved_views` (+ `documents` if not already created in Phase 1)
- [ ] `src/modules/entities/` (CRUD, identifier normalization, unit tests)
- [ ] `src/modules/connections/` (`getConnections()` — the one union-query helper)
- [ ] `entity-merge.service.ts` + `merge_entities()` Postgres function
- [ ] Custom-field decision-rule runtime assertion. **Also**: the entities/custom-fields UI and
      every Server Action must read custom field *definitions* from our own `custom_field_defs`
      mirror only, never `GET /api/custom_fields/` directly — confirmed via the Phase 0
      isolation spike that Paperless's own endpoint leaks definitions across tenants even with
      `owner`/`set_permissions` correctly set (`docs/spike-findings.md` §1, #6). Also add
      isolation coverage for custom field *values* on documents (test #7) as a first priority —
      untested in Phase 0, could be a deeper leak than definitions since we don't mirror values.
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
- [ ] Load test at 50k-document/largest-tenant scale. **Includes a real-scale OCR throughput
      benchmark**: real scanned PDFs (not synthetic text files), a real dedicated-vCPU host (not
      a shared-vCPU dev box), and the `paperless-worker` container split fixed (see the Phase 0
      note above) — this is what actually retires the throughput question in
      [ADR-0011](adr/0011-decline-mistral-ocr-pipeline.md), which this session's 100-document
      synthetic-file spike could not.
- [ ] Restore drill — both databases **and** the Paperless media volume — documented, RTO/RPO
      measured
- [ ] Monitoring/alerting live (queue depth, DLQ, OCR backlog, isolation failure, disk, backups)
- [ ] Single-host resource budgets set and measured under concurrent-import load
- [ ] DPA/subprocessor docs, GPL boundary legal review, Slovenian localisation, onboarding flow
- [ ] Docs updated
- [ ] **Phase 5 exit criteria met — MVP ready for first real customer**
