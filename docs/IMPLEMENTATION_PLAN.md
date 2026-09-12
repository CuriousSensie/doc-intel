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
- [x] Supabase Cloud project created (`DocIntelligence`, eu-west-1), `.env` configured, all 12
      migrations applied via `supabase db push`. Fixed a real bug surfaced by the real CLI run
      (exactly the gap the `pomocnik_orgs_extension` migration note flagged — "No live Supabase
      project exists yet this session to run it through the real CLI"): `alter type ... add
      value 'read-only'` followed by a function body using that value in the same migration
      file fails with `SQLSTATE 55P04` (new enum values can't be referenced by a function
      compiled in the same transaction they were added in). Split
      `has_organization_write_access()` + the `files_insert_owner` policy rewrite into a new
      migration `20260824120000_pomocnik_write_access_function.sql` running immediately after
      the enum-add commits. `check-rls-coverage.ts` and `supabase db advisors --linked` both
      pass — only pre-existing-pattern WARNs (no ERRORs), same `SECURITY DEFINER`-in-`public`
      shape as the existing `is_organization_member()`/`has_organization_role()` helpers.
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
- [x] `src/modules/tenants/provision-tenant.ts` + `worker/jobs/provision-tenant.ts`, wired into
      `worker/registry.ts` and enqueued from `organizations.service.ts`'s `createOrganization()`.
      Grants `TENANT_MODEL_PERMISSIONS` (bare codename, not `app_label.codename`) via
      `findOrCreateGroup()`. **Idempotency is find-or-create at every Paperless-side step**
      (`name__iexact` lookup before create — confirmed live that plain `?name=` is not an exact
      filter and silently returns everything), **not delete-based compensating cleanup**: a
      partial run leaves state the next retry discovers and resumes, which doesn't require
      undoing partially-completed external API calls. **Concurrency is a conditional-UPDATE
      claim** (`claim_provisioning()`, `pending`/`provisioning_failed` → `provisioning`, returns
      whether *this* call claimed it) **rather than a Postgres advisory lock** — a session-scoped
      advisory lock isn't safe over PostgREST's pooled per-request connections (lock and unlock
      could land on different pooled connections), and the actual work spans external Paperless
      calls between DB round-trips anyway, so a lock held for one RPC call wouldn't cover the
      real race. This is a deliberate change from this checklist's earlier "advisory-locked"
      phrasing once the pooled-connection constraint was worked through — not a spec
      requirement, just this item's own earlier wording turning out to describe an unsafe
      mechanism for this specific case.
      `complete_provisioning()`/`fail_provisioning()` (ADR-0008: provisioning's audit record is
      atomic with the domain write) seed the four system `entity_types`
      (customer/project/employee/contract, Slovenian labels per specs/05's field_schema
      example), four default document types (Invoice/Contract/Service report/Quotation, spec's
      literal English list — no demonstrated localization pattern for document type names the
      way entity field labels have one), and one default storage path.
      **Verified against the live Paperless instance**: fresh create, then a second pass reusing
      every id (group/user/document-type/storage-path all byte-identical to the first pass), and
      the retry's password-reset-then-relogin produces a token that actually authenticates
      (checked with a real API call, not just a non-empty string) — committed as
      `src/modules/tenants/provision-tenant.test.ts` (skips without a live instance configured,
      runs for real in CI's dedicated Paperless step). `claim_provisioning()`/
      `complete_provisioning()`/`fail_provisioning()` verified against a throwaway Postgres
      container: first claim succeeds, concurrent second claim correctly refused, retry-after-
      failure re-claimable, `complete_provisioning()` idempotent on re-run (still exactly 4
      entity_types, no duplicates). No live Supabase project exists yet this session, so the
      full `provisionTenant()` orchestration (Paperless calls + real RPC calls together) is
      unverified end-to-end — each half is verified against its real dependency separately.
- [x] `POST /admin/orgs/:id/reprovision` — implemented as `reprovisionOrganizationAction`/
      `reprovisionOrganizationAdmin` (Server Action per [ADR-0009](adr/0009-route-handlers-vs-server-actions.md),
      not a literal route), matching the existing `admin.actions.ts` pattern. Rejects
      `ready`/`provisioning` orgs with a clear message rather than silently no-op-enqueueing;
      reuses `provisionTenant()`'s own idempotency for `pending`/`provisioning_failed`. Admin UI:
      a provisioning-status badge and conditional "Reprovision" button on `/admin/organizations`.
      Unit-tested (3 cases: ready → rejected, provisioning → rejected, failed → enqueues + logs).
- [x] `src/lib/paperless/client.ts` — `paperlessFor(orgId)`/`paperlessAdminClient()`, retry with
      backoff+jitter, structured logging, 30s/120s timeouts, `createOwnedObject()` with a
      required + runtime-validated permissions argument (isolation test #20), ESLint-restricted
      admin-client import, `resolveTenantForPaperlessDocument()` narrow export. `errors.ts`
      translates Paperless 403→our 404 (confirmed necessary by the Phase 0 spike,
      `docs/spike-findings.md` §1 #8). `token-crypto.ts` (AES-256-GCM) unit-tested. **Verified
      end-to-end against the live Paperless instance** — GET/POST/PATCH/DELETE, the
      ownership-mismatch guard, and the 404 mapping all confirmed working against real
      responses, not just typecheck. `documents.ts`/`fields.ts`/`tags.ts`/`workflows.ts`
      typed wrappers not yet built — added as real callers (upload pipeline, entities) need
      them, per the "read the real response" lesson from Phase 0.
- [x] Paperless contract tests in CI against a live container — `.github/workflows/ci.yml`'s
      `continue-on-error` removed now that `src/lib/paperless` has real tests
- [x] `documents` mirror table + `document_uploads` table + `document-uploads` Storage bucket
      (`20260828000000_document_uploads.sql`). Verified as a real non-superuser Postgres role
      (not `psql -U postgres`, which bypasses RLS) — first time this session RLS *enforcement*
      itself was tested this way, not just the underlying `has_organization_write_access()`
      function; a `read-only` member's insert is correctly rejected by the policy, a `member`'s
      succeeds.
- [x] `src/modules/documents/documents.service.ts` — `createUploadIntent()` (validates size/mime
      against `src/config/documents.ts`, inserts via the caller's own RLS-scoped client so
      `has_organization_write_access()` gates it for free, generates a signed upload URL via
      the admin client, deletes the row if URL generation fails) and `completeUpload()`
      (confirms the object actually exists in storage before trusting the client, enqueues
      `validateUpload`). `src/lib/api-response.ts` is the new `{data,meta}`/`{error}` envelope
      helper `specs/03-api.md` requires and [ADR-0009](adr/0009-route-handlers-vs-server-actions.md)
      assumed already existed but didn't — error codes stay the existing lowercase `AppError`
      convention, not the spec's literal UPPER_SNAKE (`docs/GLOSSARY.md`). Two Route Handlers
      (`/api/documents/upload-intent`, `/api/documents/upload-complete`) per ADR-0009 — fetch-
      based, so they use `getAuthContext()` + a 401 JSON body, not `requireUser()`'s redirect
      (a `fetch()` call can't usefully follow a redirect to an HTML login page — found while
      writing these, `files/[id]/download/route.ts`'s `requireUser()` is fine there specifically
      because that route *is* a browser-navigated redirect). 8 unit tests (mocked Supabase
      clients — the real Storage signed-URL behavior needs a live Supabase project, not
      available this session; each assumption about `createSignedUploadUrl()`'s shape is cross-
      checked against the installed `@supabase/storage-js` source, not guessed).
- [x] `worker/jobs/validate-upload.ts` (MIME re-sniff + ClamAV). ClamAV wasn't provisioned
      anywhere in the repo — added a `clamd` container (`infra/docker-compose.yml`, `full`
      profile, pinned `clamav/clamav:1.5.4`), `CLAMAV_HOST`/`CLAMAV_PORT` env vars, and a
      hand-rolled INSTREAM TCP client (`src/lib/files/scan.ts`, no new npm dependency — see
      [ADR-0012](adr/0012-clamav-scan-service.md) for why). Verified end-to-end against the real
      container this session (not mocked): pulled the image, waited out the first-boot
      signature-DB download, ran the client from a throwaway container on the same Docker
      network — EICAR test string correctly flagged `infected: true` (`Eicar-Test-Signature`), a
      clean buffer passes. `src/lib/files/validate.ts` generalized to
      `validateFileAgainstConfig()` (any `{maxSizeBytes, allowedMimeTypes}` config, not just
      `FileCategory`) and extended with TIFF (both byte orders) and a generic zip-container
      signature so OOXML/ODT don't silently skip the re-sniff. New migration
      `20260912125436_document_upload_validation_functions.sql` adds
      `claim_upload_validation()`/`complete_upload_validation()`/`fail_upload_validation()`
      (same conditional-UPDATE pattern as `claim_provisioning()` et al.) — these explicitly
      reject non-`service_role` callers, closing the same public-`SECURITY DEFINER`-callable gap
      the advisors flag on the provisioning trio rather than replicating it. All 12+1 migrations
      pushed and typed (`src/types/database.ts` updated by hand to match the checked-in file's
      formatting, not the raw `supabase gen types` output — see commit for why).
- [x] `worker/jobs/submit-upload-to-paperless.ts` (task-id persisted, resumable). Added
      `PaperlessClient.setOwnedObjectPermissions()` (`src/lib/paperless/client.ts`) — the
      isolation spike found `post_document/` does **not** itself grant the tenant group
      view/change on the resulting document, so this job PATCHes that on explicitly once the
      task succeeds, the same P1-leak class `createOwnedObject()` already guards against for
      JSON-created objects. `src/lib/paperless/tasks.ts` adds the `/api/tasks/` poll loop
      (fixed 2s interval, ~60s budget, matching the isolation spike's verified values — lowercase
      `status`, `related_document_ids` as a list) and strips the quotes `post_document/`'s bare
      task-id response wraps them in. Resumability point is `document_uploads.paperless_task_id`
      itself, not a claim RPC — a retry that finds it already set skips straight to polling
      instead of re-POSTing (non-idempotent endpoint).
- [x] `worker/jobs/sync-paperless-document.ts` (shared by upload, webhook, reconciliation).
      Webhook route and both reconciliation jobs don't exist yet, so this only has one real
      caller today (submit-upload-to-paperless.ts, passing `uploadId`) — designed its signature
      `(orgId, paperlessDocumentId, uploadId?)` to fit the other two once built, per
      specs/01-architecture.md's event-bridge section (webhook passes no uploadId; reconciliation
      loops this per missing document, not a batch). Added `src/lib/paperless/documents.ts`
      (`getPaperlessDocument`/`getPaperlessDocumentTypeName`/`getPaperlessCorrespondentName`, none
      existed) and `toDocumentTypeKey()` — `document_type_key` has no canonical source anywhere
      in the spec or schema, so this lowercases+underscores the Paperless document_type's own
      name as a documented judgment call, not a guess. `page_count`/`checksum` are left null for
      every caller (no live-verified Paperless endpoint for them — flagged as a follow-up spike,
      not guessed); `byte_size`/`mime_type` are only filled on the upload path, from
      `document_uploads`' own columns. Idempotent via `documents`' own
      `(organization_id, paperless_document_id)` upsert rather than a claim step, since multiple
      callers (webhook + reconciliation) can legitimately race on the same document. Also writes
      the first-ever `paperless_object_map` row with `object_type='document'` (nothing did
      before this), defensively: a unique-constraint hit is only trusted as "already ours" after
      confirming the existing row's `organization_id` matches, otherwise it throws loudly instead
      of silently reassigning a cross-tenant mapping. Enqueues `runRule` (document.ingested
      trigger — rule engine itself isn't built, this only fires the trigger) and best-effort
      `logEvent()` + `createNotification()` for the uploader (no uploader to notify on the
      webhook/reconciliation paths, so notification is skipped there).
- [x] `worker/jobs/expire-abandoned-uploads.ts`. Global sweep (not tenant-scoped — unlike every
      other job, it ignores `job.data.orgId`, an unused placeholder kept only to satisfy
      `enqueue()`'s `{orgId: string}` constraint), flipping any `document_uploads` row still
      `pending`/`uploaded` past its own `expires_at` to `expired` via
      `document_uploads_expiry_idx`. Actually wired to a recurring trigger, not just written and
      left unscheduled like `purge_old_audit_logs()` (`docs/SECURITY.md`'s documented gap) —
      `worker/index.ts` now registers it on every boot via BullMQ v6's
      `Queue.upsertJobScheduler()` (every 5 min), which is keyed by scheduler id so a container
      restart re-registering it doesn't create duplicate schedules. Verified live against a real
      Redis container this session (not just typechecked): registered the scheduler, watched it
      actually fire repeatedly, then re-upserted it and confirmed `getJobSchedulers()` still
      showed exactly one entry, not two.
- [ ] `src/lib/errors.ts` extended (413/422/502/503)
- [x] `audit_logs.actor_type` column (`20260826000000_tenant_provisioning.sql`); retention
      extended to 2 years (`20260827000000_audit_log_retention.sql`)
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
