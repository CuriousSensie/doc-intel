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
- [x] Slovenian OCR spike — `tesseract-ocr-slv` confirmed present in the pinned image and
      configured correctly. Verified against a real Slovenian invoice pulled directly from the
      live Paperless instance (`GET /api/documents/105/`, diffed line-by-line against the source
      image): prose/label fidelity is excellent (č/š/ž all correct, no mojibake), but **tabular
      numeric data — line items, multi-currency totals — is dropped entirely, not just
      misaligned**, a real and reproducible gap (Tesseract's known weakness on ruled-line-free
      multi-column tables), not a Slovenian-specific issue. Kill criterion not triggered (the
      gap is narrow, not general "poor accuracy"), but tracked as a real limitation for anything
      relying on OCR text to capture every number on an invoice — see `docs/spike-findings.md`
      §3.
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
- [x] `docs/audit-boilerplate.md` — consolidates the 8 questions `specs/04-level-0-foundation.md`
      asks for into one document, citing the ADR/code that already answered each rather than
      re-litigating them (they were answered incrementally as ADRs during the actual build, not
      as a single upfront gate). Bottom line: extend, don't replace — every boilerplate
      primitive (RLS, role model, BullMQ, Supabase Storage, migration tooling) already fit.
      Surfaced one real, newly-fixed gap while writing it: no queue anywhere had a retry policy
      configured, contradicting every job's own resumability design (see this session's
      queue/index.ts fix, above).
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
- [x] `src/lib/errors.ts` extended (413/422/502/503) — stale checkbox, fixed: `PayloadTooLargeError`,
      `UnprocessableError`, `PaperlessUnavailableError`, and `OrgNotProvisionedError` already
      existed from an earlier session and are in active use by this session's jobs
      (`submit-upload-to-paperless.ts`, `paperlessFor()`). `ScanUnavailableError` (502) added
      this session for `src/lib/files/scan.ts`.
- [x] `audit_logs.actor_type` column (`20260826000000_tenant_provisioning.sql`); retention
      extended to 2 years (`20260827000000_audit_log_retention.sql`)
- [x] Transactional audit Postgres functions ([ADR-0008](adr/0008-transactional-audit-writes.md)).
      Of the ADR's six named mutation categories, four (connection create/delete, rule action
      application, import completion, AI run acceptance) don't have underlying features built
      yet (Phase 2-plus) and tenant provisioning already had this from an earlier session
      (`complete_provisioning()`/`fail_provisioning()`). The remaining category, "permission
      changes," was still going through a plain mutation + a separate best-effort `logEvent()`
      call — `update_member_role()`, `remove_member()`, and `leave_organization()` (new) plus
      `transfer_organization_ownership()` (existing, audit insert added) now do the domain write
      and the `audit_logs` insert atomically, replicating the same `auth.uid()`/
      `has_organization_role()` authorization check `transfer_organization_ownership()` already
      used rather than relying on RLS (security definer bypasses it). The three call sites'
      separate `logEvent()` calls were removed — same convention `provisionTenant()` already
      established (no `logEvent()` call at all once the RPC owns the audit write). Every
      function verified live against the real Supabase Cloud project: called unauthenticated,
      confirmed each raises the expected `P0001: Authentication required` from inside the
      correct function body (not a generic/structural SQL error), which confirms argument types
      and column references resolve correctly.
- [x] `listAuditLogsForSubject()` scoped read (`src/modules/admin/audit-log.service.ts`) —
      specs/03-api.md's `GET /audit` "filter by subject": audit history for one entity (a
      document, an `organization_member`, etc.), not the app-admin global feed
      `listAuditLogs()` already covers. Adds no authorization of its own — scoping is RLS alone
      (`audit_logs_select_admins`: app admin, or an org owner/admin for their own org's rows),
      same as the existing function. Same cursor-pagination shape, unit-tested for the
      `entity_type`/`entity_id` filter and error propagation.
- [x] `src/app/api/internal/paperless/document-consumed/route.ts` (HMAC body+timestamp, replay
      window, event dedup). `src/lib/paperless/webhook-signature.ts` verifies the HMAC-SHA256
      over body+timestamp (matching `infra/scripts/notify-pomocnik.sh` exactly) with a 5-minute
      clock-skew/replay tolerance window and a timing-safe comparison. Dedup reuses the existing
      generic `webhook_events` table (provider `'paperless'`) rather than a new table — keyed by
      the signature itself as the event id, since notify-pomocnik.sh's payload has no event id
      of its own to give us. An unresolvable tenant (`resolveTenantForPaperlessDocument()`
      returns null — a document Pomočnik hasn't synced yet) is handled as a normal, expected
      case, not an error: it's deferred to the reconciliation sweep's backstop rather than
      guessing an org. Added `POMOCNIK_WEBHOOK_SECRET` to `src/lib/env.ts` and generated+appended
      a real value to the local `.env` (was entirely missing — the script required it but
      nothing provisioned it). Verified end-to-end against a real running dev server this
      session (not just typechecked): correctly-signed request with an unmapped document id →
      `200 {resolved:false}`; bad signature → `401`; missing headers → `401`; stale/replayed
      timestamp → `401`; exact replay of a valid request → deduped via `webhook_events`. Test
      rows cleaned up from the live Supabase project afterward.
- [x] `worker/jobs/reconcile-incremental.ts` (5 min, added+modified, full pagination). One job
      that loops over every `provisioning_status='ready'` org internally (not fanned out
      per-tenant — no queue/payload contract exists for that, same shape as
      `expire-abandoned-uploads.ts`); a single tenant's failure is logged and skipped rather than
      aborting the rest. Queries Paperless for `added__gte`/`modified__gte` since
      `last_reconciled_at` minus a 2-minute overlap window (spec says "minus overlap window"
      without naming a value), unions both id sets, and enqueues `sync-paperless-document.ts`
      for every candidate — including ones already mirrored, since its upsert is how a
      Paperless-side metadata edit (retitled, re-typed) ever reaches the mirror at all, not just
      brand-new documents. `src/lib/paperless/documents.ts`'s `listAllPaperlessDocumentIds()`
      follows Paperless's `next` pagination fully. Structurally cannot detect a deletion (see
      `reconcile-full-sweep.ts`) — it only ever sees what's inside the added/modified window.
- [x] `worker/jobs/reconcile-full-sweep.ts` (daily, full listing, deletion detection). Same
      per-tenant-loop shape as the incremental job, but lists every document a tenant has in
      Paperless (no date filter) and diffs it against the `documents` mirror both ways: anything
      in Paperless but not mirrored gets enqueued for sync; anything mirrored (and not already
      `orphaned`) but missing from the live Paperless listing gets `status='orphaned'` directly
      (this job's own write, not `sync-paperless-document.ts`'s — that job has no delete-side
      path). `GET /api/documents/` pagination, `added__gte`/`modified__gte`/`ordering`/
      `page_size` query params, and the document response's real field shape (`page_count`,
      `mime_type` as direct fields; checksum nested under `versions[].checksum`; no `byte_size`
      field anywhere) were all confirmed live against the real pinned instance this session, not
      assumed — see the preceding commit's fix to `sync-paperless-document.ts`. Verified the
      full loop end-to-end against the real Supabase Cloud project and a real Paperless
      container: provisioned a throwaway tenant, uploaded a real document, ran the incremental
      sweep (created the mirror row via the real worker consuming the real enqueued job), ran
      the full sweep (confirmed `ready`, 0 orphaned), deleted the document in Paperless, ran the
      full sweep again — `status` flipped to `orphaned`, `last_reconciled_at` updated. Test
      tenant and its Paperless-side objects cleaned up afterward.
- [x] Upload pipeline job retry resilience — a real bug, not a hypothetical: BullMQ jobs had no
      retry policy anywhere (`attempts` defaults to `1`), so a single transient failure (found
      live during e2e testing: an isolated `AggregateError [ECONNREFUSED]` on one
      `post_document/` call) permanently failed the job with zero retries, contradicting every
      job's own resumability design (checkpointing via `paperless_task_id`, conditional claims)
      which assumes a retry actually happens. Fixed in `src/lib/queue/index.ts` —
      `defaultJobOptions: { attempts: 3, backoff: exponential }`. Enabling retries then surfaced
      a second real bug: `validate-upload.ts`'s claim (`uploaded -> validating`) and
      `submit-upload-to-paperless.ts`'s claim (`validated -> submitting`) each only matched
      their *starting* status, so once a first attempt claimed the row, a BullMQ retry of that
      *same* job could never reclaim it — the claim UPDATE matched zero rows, the job logged
      "skipped_not_claimable" and returned successfully without doing anything, permanently
      stranding the row. Fixed by relaxing both claims to also accept the status the job itself
      transitions to (migration `20260913061540_relax_upload_claim_for_retries.sql` for the
      RPC; a widened `.in("status", [...])` for the plain-SQL one) and by threading a new
      `isLastAttempt` flag (`worker/context.ts`) through all three jobs so only the *final*
      attempt writes a terminal `'failed'` status — a mid-retry failure now leaves the row in
      its in-progress status, resumable by the next attempt, instead of stuck. Also improved
      `PaperlessClient`'s error logging (`src/lib/paperless/client.ts`) to unwrap
      `AggregateError`'s nested `.errors[]` — the top-level `.message` for a connection failure
      is just the unhelpful generic `"fetch failed"`, which is what made this whole class of bug
      invisible until deliberately dug into.
- [x] Minimal documents UI (`/dashboard/documents`) — list + direct-to-storage upload form,
      enough to actually exercise the upload pipeline through the real app rather than only via
      API routes. `listDocuments()`/`listRecentUploads()` added to `documents.service.ts` (a
      deliberately minimal, unfiltered version — the full mixed-filter `listDocuments()` with
      `q`/type/date/entity filters is Phase 2 scope per the plan; search passthrough below still
      depends on that). Client-side upload (`document-upload-form.tsx`) is the first real
      browser-side caller of `src/lib/supabase/client.ts` — which surfaced a genuine,
      previously-invisible bug: `NEXT_PUBLIC_*` env vars were never actually reaching the client
      bundle (see the dedicated fix commit). Verified end-to-end with a real Playwright e2e test
      (`e2e/documents.spec.ts` + new `e2e/helpers/test-fixtures.ts` — a real confirmed Supabase
      Auth user, a real provisioned tenant via the actual `provision-tenant` queue, a real
      worker container, a real Paperless instance): login → upload a PDF → watch it move through
      validate → submit-to-paperless → sync → `ready`, visible in the UI. Needed a real minimal
      PDF fixture, not an arbitrary image — a 1×1 PNG with no DPI metadata is a genuine Paperless
      rejection (`"no DPI information is present... OCR_IMAGE_DPI is not set"`), not a bug.
- [ ] Search passthrough on `documents.service.ts`
- [x] `e2e/isolation.spec.ts` — tests 1, 3, 4, 5, 6, 8, 17, 18, 19, 20 (2 and 7 need routes/data
      that don't exist yet — our own `documents.getDocument()` and Paperless custom field
      *values* on a document — tracked as still-open, not silently dropped; 9-16 excluded, blocked
      on Phase 2-5 features; 12 tracked separately). Ported from `scripts/spike/isolation.ts`
      using the real production client (`paperlessFor()`, `createOwnedObject()`,
      `postForm()`/`pollPaperlessTask()`) instead of the spike's standalone hand-rolled helpers —
      real two tenants, real Paperless, real Supabase, no mocks. Two new checks the spike
      couldn't cover, both exercising Phase 1 code that didn't exist yet when the spike ran: #18
      (a real `authenticated`-role Supabase client, not the admin client, denied downloading
      another org's upload by its storage path — confirms the private-bucket-no-RLS-grant design
      holds) and #19 (`upsertDocumentObjectMap()`, exported for this test, correctly throws
      instead of reassigning when a `paperless_object_map` row is already claimed by another
      org — the normal call path can't reach this branch since Paperless's own ACL already stops
      a leak from surfacing, so this calls it directly to prove the defense-in-depth guard
      itself works). #6 (`custom_field_defs` leak) uses `test.fail()`, not an inverted
      assertion — this is `docs/spike-findings.md` §1's confirmed, still-open Paperless bug, so
      the test is *expected* to fail; if Paperless ever fixes it upstream this starts
      unexpectedly passing, which Playwright flags loudly rather than silently going green.
      Verified live: 10/10 report correctly (9 real passes, 1 tracked expected-failure).
- [x] `.github/workflows/ci.yml` (lint/typecheck/test/build + Playwright against a real
      Paperless container and a CI-scoped Supabase Cloud/local Supabase test project) — written;
      not yet run in actual GitHub Actions (no push to a remote this session)
- [x] `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/MODULES.md`, `docs/SECURITY.md`,
      `docs/SETUP.md` updated for this session's work (new Functions/migration-history rows, a
      new `## Documents` module section, the corrected 2-year — not 30-day — audit log
      retention number, the ClamAV/`redis-app`-port setup steps, and more; each file's diff is
      the actual record of what changed and why).
- [ ] **Phase 1 exit criteria met** (see plan §Verification) — status per sub-criterion:
  - [ ] Two tenants provisioned automatically; each logs in, uploads a Slovenian scanned PDF,
        sees it OCR'd and searchable — provisioning/upload/OCR each verified independently this
        session (real tenant via `worker/jobs/provision-tenant.ts`, real upload through
        `/dashboard/documents` in `e2e/documents.spec.ts`, real Slovenian OCR fidelity per
        `docs/spike-findings.md` §3), but never as one continuous two-tenant walkthrough in a
        single session.
  - [x] `e2e/isolation.spec.ts` (tests 1-8, 17-20) green — done this session.
  - [ ] Killing the post-consume bridge loses no documents once both reconciliation jobs run —
        both jobs are built and individually verified (including a real deletion→`orphaned`
        transition), but the actual "kill the bridge mid-flight, confirm reconciliation alone
        recovers it" drill hasn't been run.
  - [x] `infra/docker-compose.yml` boots from a clean checkout with one command — verified for
        `--profile paperless`. `--profile full` (the actual all-of-it path) is not yet verified
        clean-checkout, since `infra/.env` in this environment doesn't yet carry the app's own
        Supabase/Stripe/SMTP vars alongside the Paperless ones — `docs/SETUP.md`'s setup
        instructions already say `infra/.env` should have both, this environment's copy just
        doesn't yet.
  - [x] A restore of both databases has been performed once — done this session, live: dumped
        the real Supabase Cloud project (schema live-verified via the earlier migration work;
        a fresh data-only dump/restore round-tripped a real row byte-for-byte, same UUID and
        timestamp) and the real Paperless Postgres + its `data`/`media` volumes (restored into
        a fully isolated throwaway network/containers, confirmed a pre-existing document's
        metadata, the tenant's total document count, and its file content byte-for-byte
        identical to the live original). All throwaway infrastructure torn down afterward; live
        containers untouched throughout.

## Phase 2 — Level 1 Structure & Connections

- [x] Migration: `entities`, `entity_identifiers`, `connections`, `custom_field_defs`,
      `saved_views` (`entity_types` already existed from Phase 1) —
      `supabase/migrations/20260914000000_entities_connections_fields_views.sql`, plus
      `merge_entities()`. Verified against a throwaway Postgres container: all 17 migrations
      apply cleanly in order; unique constraints (`entity_identifiers`, `connections_unique_pair`,
      `custom_field_defs`) correctly reject duplicates; `merge_entities()` moves
      identifiers/connections, archives the merged entity, writes one audit row, and rejects
      unauthenticated/cross-org/self-merge calls; RLS itself (as a real non-superuser role, not
      just the helper functions) blocks a cross-tenant read and write. Pushed to the live
      Supabase Cloud project — a prior migration (`20260913120000_drop_files_and_projects.sql`)
      had to be fixed first: Supabase Cloud rejects direct SQL writes to `storage.objects`/
      `storage.buckets` (SQLSTATE 42501, "use the Storage API instead"), so that migration's
      bucket cleanup was dropped (the `files` bucket is left as a harmless orphan).
- [x] `src/modules/entities/` (CRUD, identifier normalization, dynamic per-entity-type data
      validation, unit tests) + `src/modules/entity-types/` (field-schema evolution rules: add/
      rename-label/lossless-type-change/soft-remove, per specs/05). 24 unit tests; verified
      end-to-end against the real live Supabase project (not mocks) — entity type + field CRUD,
      identifier auto-promotion, duplicate-identifier conflict rejection, search-by-identifier.
- [x] `src/modules/connections/` (`getConnections()` — the one union-query helper, hydrated with
      the other side's label) + `entity-merge.service.ts` (thin wrapper over `merge_entities()`,
      maps its raised exceptions onto the app's error taxonomy). Verified end-to-end against the
      real live project, including a real merge through an actual authenticated session (the RPC
      checks `auth.uid()` itself, so this only works with a request-context client, not the
      admin client) — self-connection rejection, duplicate-pair rejection (reversed order),
      direction-symmetric hydration, real merge re-pointing connections, self/cross-org/
      unauthenticated merge rejection.
- [x] Custom-field decision-rule runtime assertion — `src/modules/custom-fields/
      custom-field-defs.service.ts` rejects any `documentlink`-typed field def with a non-null
      `paperless_custom_field_id` (specs/12-agent-rules.md rule 6: an entity link can never be
      backed by a real Paperless field). **Also**: this module is the only place custom field
      *definitions* are ever read for the tenant-facing app — confirmed via the Phase 0 isolation
      spike that Paperless's own `GET /api/custom_fields/` leaks definitions across tenants even
      with `owner`/`set_permissions` correctly set (`docs/spike-findings.md` §1, #6). Isolation
      test #7 (custom field *values* on a document, cross-tenant) added to
      `e2e/isolation.spec.ts` — two angles: the same per-document 404 as test #3 now with a real
      value attached, and a `custom_field_query` filter attempt using the leaked definition id
      from #6, neither of which surfaces tenant A's document to tenant B.
- [x] `documents.service.ts` — `listDocuments()` mixed-filter (type/date/status served from our
      own mirror; `q`/`tag` delegated to Paperless since we don't mirror content or tags;
      `entityId`/`hasNoConnections` business filters served entirely from our DB), `getDocument()`
      (mirror + `getConnections()` + best-effort live Paperless custom fields, degrading to
      `null` rather than failing the page on a Paperless outage/orphaned document), 
      `updateDocument()` (title/date/type/custom-field writes go through to Paperless first, the
      mirror is updated from Paperless's own response via the admin client — `documents` has no
      update RLS policy at all, so the write-access/read-only check that RLS would otherwise
      provide is done explicitly in application code), `getDocumentHistory()` (merged Paperless
      `/api/documents/:id/history/` — confirmed live, not paginated on this version — plus our
      own business `audit_logs`). New `src/lib/paperless/documents.ts` wrappers
      (`updatePaperlessDocument`, `getPaperlessDocumentHistory`) and a `getStream()` method on
      `PaperlessClient` for binary preview/download proxying. `connections.service.ts`'s
      `getConnections()` extended to hydrate entity type key/name (for panel grouping) and an
      `isDeleted` flag (specs/05: "connected entity was deleted" soft-delete UX, not a silently
      dropped link).
- [x] Routes: `src/app/api/documents/[id]/preview/route.ts` and `.../download/route.ts` —
      streamed through our own session-authenticated Route Handler (ADR-0009), never a redirect
      to a raw Paperless URL carrying the tenant service-user token.
- [x] `src/app/(dashboard)/dashboard/documents/[id]/page.tsx` — `pdf-viewer.tsx` (sandboxed
      `<object>`, no PDF.js dependency, no embedded-JS surface) + `connections-panel.tsx`
      (grouped by entity type — "the highest-value surface in the product" per specs/05) +
      metadata + custom fields + merged history. Empty/loading/error states: `loading.tsx`
      skeleton, `notFound()` for a missing/cross-tenant id, graceful Paperless-unavailable
      degradation. Documents list page now links each row to its detail page.
      Verified end-to-end (`e2e/document-detail.spec.ts`, new) against the real live Paperless +
      Supabase Cloud stack — page render with metadata/empty-connections state, cross-org id
      correctly 404s via `notFound()`, and the preview route streams the real file content
      authenticated only by the session cookie. Full `e2e/isolation.spec.ts` (11 tests)
      re-verified green after these changes.
- [x] Dashboard nav entries + feature flags for `entities`/`views` (on) and `imports`/`rules`
      (off placeholders, invisible until Phase 3/4 flip them) — `src/config/features.ts`,
      `src/config/navigation.ts`. Role-gated dashboard home (`dashboard/page.tsx`): owner/admin
      see an org-health summary, member/read-only see a task-focused view
      (`src/modules/dashboard/dashboard.service.ts`).
- [x] Routes: `entities/`, `entities/[typeKey]/`, `entities/[typeKey]/[id]/` (Overview/
      Connections/Activity tabs, reusing `ConnectionsPanel`), `entity-types/`,
      `entity-types/[id]/` (admin-only field-schema editor: add field / hide field, respecting
      Milestone 2's evolution rules). Dynamic per-field-type native inputs
      (`entity-field-input.tsx`). Verified end-to-end (`e2e/entities-ui.spec.ts`, 7 tests) against
      the real live stack.
- [x] `src/modules/saved-views/` — `ensureStarterViews()` lazily seeds the five spec-required
      views (All documents, Documents with no connections, Invoices this year, Open contracts,
      Recently added) on first visit to `dashboard/views/page.tsx`, matching
      `complete_provisioning()`'s own seeding-on-demand pattern rather than a migration-time seed.
- [x] Searchable cross-entity-type connection picker (`connection-picker.tsx`) — two interactions
      (type, click), a new `GET /api/search` Route Handler (ADR-0009's designated fetch surface)
      doing entity name/identifier match, wired into both the document detail page and the
      entities list. Documents list gained filter query-param support
      (`documentTypeKey`/`status`/`dateFrom`/`dateTo`/`q`/`hasNoConnections`) so saved views
      actually filter the list they link to.
      **Real bug found and fixed via live e2e testing**: this codebase has no `revalidatePath`
      anywhere, and `redirect()` to the same URL a form was submitted from does not force Next.js
      to refetch stale Server Component data — every new form action (create entity, create
      entity type, add field) now appends a status query param (`withStatus()`) to its success
      redirect to force a real refetch, matching how error-path redirects already did this by
      coincidence.
- [x] Bulk connect (`bulkConnectDocumentsAction` — selection-across-pages or "select all matching
      filter" via `listDocumentIds()`, ≤50 items runs synchronously, >50 enqueues
      `worker/jobs/bulk-action.ts` with live progress via a `background_operations` tracking
      table), per-item failure reporting, session-scoped undo (`undoBulkConnectAction`, reverses
      the connections a bulk operation created). Paperless-side bulk edit
      (type/tag/correspondent/custom-field/reprocess/delete) proxied via `bulk_edit`
      (`bulkEditPaperlessDocuments`), never reimplemented. Verified end-to-end
      (`e2e/bulk-and-export.spec.ts`) — bulk-connecting 3 real documents, undo, and (live,
      unscripted) a real cross-tenant `bulk_edit` call returning 403 from Paperless's own ACL.
- [x] `src/modules/exports/` (`resolveExportData()` — batched connected-entity column resolution,
      never N+1) + `file-builders.ts` (CSV: `;` delimiter + BOM for Slovenian-locale Excel;
      streaming XLSX via `exceljs`) + `worker/jobs/export.ts` (always async, uploads to a private
      `exports` storage bucket) + `GET /api/exports/[id]/download` (short-lived signed URL
      redirect, same private-bucket pattern as `document-uploads`). Original-files ZIP export
      (spec's explicitly optional add-on) **not built** — CSV/XLSX row export only. Verified
      end-to-end: exported CSV downloaded and its bytes checked, including a real connected-entity
      column resolved from a live bulk-connect.
- [x] **Real isolation gap found and fixed**: `createConnection()` had no check that
      `source_id`/`target_id` actually belonged to the caller's org before inserting (`connections`
      has no FK on either side — polymorphic by design) — a request could create a connection row
      naming another tenant's entity/document id and it would silently succeed. Added
      `assertBelongsToOrg()` (checks the target table, scoped by `organization_id`, before every
      insert) — this is isolation test #9's exact scenario, and the fix now makes it 404
      (`NotFoundError`) instead of a silent cross-tenant reference.
- [x] `e2e/isolation-phase2.spec.ts` — tests 9 (connection targeting another org's entity, 404),
      14 (bulk edit with another org's document id — confirmed live: Paperless's own ACL returns
      403), 15 (export with another org's document id passed explicitly — silently excluded, only
      the caller's rows come back). Test 16 (export ZIP contains only A's files) **not
      implemented** — no code to test, since ZIP-of-originals export wasn't built (see above);
      documented as a deferral, not faked.
- [x] `e2e/entity-merge.spec.ts` — Level 1 definition-of-done item 9 ("merge two duplicate
      customers without losing connections") verified live through a real authenticated session
      (`merge_entities()` checks `auth.uid()` itself) — a connection that existed only on the
      duplicate is re-pointed to the kept entity, and its VAT identifier moves too.
- [x] Docs updated — this file, `docs/SPEC_TRACEABILITY.md`, `docs/ARCHITECTURE.md`,
      `docs/DATABASE.md`, `docs/MODULES.md`, `docs/API_REFERENCE.md`.
- [x] **Phase 2 exit criteria met** — see `PHASE2_HANDOFF.md` (local only, not tracked) for the
      full walkthrough against `specs/05-level-1-structure.md`'s definition-of-done items 1–10.

## Phase 3 — Importer

All work is on `feat/phase3-imports` (not yet merged to `main`), commits 9c0135e through
ae4c984. Milestones 1–8 are implemented and verified against the real live stack (Supabase
Cloud + the pinned Paperless container + a real worker — no mocked Paperless anywhere, per
`CLAUDE.md`). Milestone 9 is now implemented and awaiting review: importer isolation test #11
is live, the `on_missing:"fail_row"`/`skip_connection` planner bug is fixed, and the 10k
ZIP+XLSX analyze/validate harness has been run against the live stack. See
`PHASE3_MILESTONE9_REVIEW.md` for changed files, verification, and remaining boundaries. All
phase documentation remains local pending final closeout.

Per this file's own rule, every item below is checked only once merged to `main` — none of
Phase 3 has been merged yet, so every checkbox stays open regardless of how much is actually
built and verified. See `docs/PHASE3_HANDOFF.md` for the full walkthrough, what's genuinely
verified vs. deferred, and how to manually exercise the pipeline.

- [ ] Migration: `import_jobs`, `import_rows`, `import_mappings` — done (M1,
      `20260915112736_phase3_import_foundation.sql`), plus `20260916090000_import_bulk_write_functions.sql`
      (`bulk_update_import_rows`, `increment_import_job_progress`) and
      `20260916140000_documents_query_perf.sql` (M7's query-perf indexes + RPC). All four
      migrations pushed to the live Supabase Cloud project this session; `check-rls-coverage.ts`
      passes.
- [ ] `src/modules/imports/` — all three kinds (entities, documents, metadata_only) — done (M5/M6):
      `imports.schemas.ts`, `imports.matching.ts` (shared plan resolution — the same function
      resolves what validate() previews AND what run-import-chunk.ts actually executes),
      `imports.apply.ts` (entity-link/field-write application, shared between the synchronous
      documents/metadata_only path and sync-paperless-document.ts's deferred path for
      newly-created documents), `imports.archive.ts`, `imports.service.ts`, `imports.report.ts`,
      `imports.actions.ts`. `custom_field` document-matching strategy is a deliberate,
      documented deferral (ADR-0016) — `filename`/`checksum`/`paperless_id` are implemented.
- [ ] `src/lib/import/parse.ts` (CSV/TSV/XLSX/ZIP, encoding/delimiter sniff, sl-SI parsing,
      unit tests) — done (M4): streaming CSV/TSV (csv-parse + iconv-lite), streaming XLSX
      (exceljs's `WorkbookReader`, never the in-memory `Workbook`), ZIP central-directory
      listing/extraction (yauzl). `.xls` deliberately unsupported (ADR-0015 — SheetJS is off the
      npm registry and has a CVE history for a parser that reads untrusted files). Encoding
      detection redesigned after live verification showed chardet scores a genuine windows-1250
      sample and windows-1252 an exact tied confidence — only a confident UTF-8 read is trusted;
      everything else falls back to windows-1250 exactly as specs/06 directs, rather than
      trusting whichever codepage cousin chardet ranked first by coincidence. 44 unit tests, all
      against real chardet/iconv-lite/exceljs/yauzl (no mocks).
- [ ] Full pipeline: analyze → map → validate → review → run → report — analyze/map/validate/run
      done (M5/M6) and verified live (real entities import with create-then-update-on-reimport;
      real ZIP+manifest documents import through the real M3 ingest pipeline, real Paperless
      document, real deferred connection creation, real cross-import entity reuse by
      identifier). M8 now adds the localized four-stage wizard, persistent preview and review,
      explicit acknowledgement, paginated row results, saved mappings and separate OCR progress.
      The real browser CSV path is verified through upload, validation, execution and report.
      `GET /imports/:id/report` done (Route Handler, live CSV generation from `import_rows`,
      never a pre-built file).
- [ ] `worker/jobs/run-import-chunk.ts` (chunked, per-row transactional, retry, bounded
      outstanding submissions) — done (M6), renamed from the originally-reserved
      `run-import-row` queue since execution is per-*chunk* (default 50 rows,
      `importsConfig.chunkSize`), not per-row. Self-perpetuating job chain (each chunk
      re-enqueues itself on completion) bounds per-org concurrency
      (`importsConfig.defaultConcurrencyPerOrganization`, default 4) without a fixed worker
      pool — `startImportJob()` enqueues exactly N initial chains. Per-row `attempts`
      (max 3, transient-vs-permanent distinguished) is separate from BullMQ's own job-level
      retry, which only covers whole-chunk infrastructure failures.
- [ ] Pause/resume/cancel/retry-failed — done (M5/M6): a Redis control flag
      (`src/lib/import/control.ts`) checked before every chunk claim/reschedule, so pause/cancel
      take effect for chunks still queued, not just future ones; in-flight chunks finish.
      `retryFailedRows()` re-queues only `status='failed'` rows.
- [ ] Duplicate-file connections-still-applied behavior — done (M6): `skip_duplicate` plans
      still run `applyEntityLinks()` against the pre-existing document.
- [ ] Per-job completion independent of OCR-queue drain — done: a `create_document` row is
      marked `ok` once its `document_uploads` row exists and ingestion is enqueued, not once
      OCR/full-text indexing finishes (that was already Phase 3 M3's own design). Its entity
      links/field writes are deferred to `sync-paperless-document.ts` (which runs once the
      document exists in our mirror, well before OCR completes) — verified live, including a
      real cross-import entity match by identifier.
- [ ] `GET /imports/:id/report` — done (M5), see above.
- [ ] Docs updated — this file, `SPEC_TRACEABILITY.md`, `DATABASE.md`, `MODULES.md`,
      `API_REFERENCE.md`, and `ARCHITECTURE.md` now describe the Phase 3 module/runtime. Final
      polishing remains local until the phase is reviewed.
- [ ] M8 UI and feature flag — implemented and committed as ae4c984; see
      `PHASE3_MILESTONE8_REVIEW.md`.
- [ ] M9 scale/isolation verification — implemented, awaiting review. `e2e/isolation.spec.ts`
      now includes isolation test #11 and passes live. `scripts/verify-phase3-m9.ts --rows 10000`
      generated a 10,000-document ZIP with XLSX manifest and ran the real analyze/validate path
      in 43.5s total (16.6s analyze, 27.0s validate, 0 row errors). The full
      `--rows 10000 --execute` run is prepared but intentionally not started without an operator
      window because it would enqueue 10,000 Paperless ingests/OCR tasks.
- [ ] **Phase 3 exit criteria met** — not yet merged to `main`; the only remaining operational
      gate is deciding when to run the full 10k `--execute` import against Paperless.

**Two real, load-bearing bugs were found and fixed only by live verification, not by any unit
test** — recorded in `docs/PHASE3_HANDOFF.md` and worth restating here since they're the kind
of thing worth remembering as a class of risk: (1) `validateImportJob()`'s dry run originally
wrote the *real* terminal row status (`ok`) during validation — the same column
`claim_import_chunk()` reads to find work — so every import silently stalled at
`processed_rows=0` forever once validated; fixed so only a genuine `action:"error"` plan gets a
terminal status from validate(), everything executable stays `pending` for the real run. (2)
Both the direct entities-import path and entity-links' `on_missing:"create"` path originally
built entities without ever writing the matched identifier value into the entity's own `data` —
so a freshly imported/auto-created entity had no `entity_identifiers` row at all, defeating
"mappings are saved per tenant and reusable" (a monthly re-import would create duplicates
forever instead of updating). Both are covered by regression tests now, but the tests only
exist *because* the live run caught them first.

## Phase 4 — Rules Engine

Work in progress, not yet merged to `main` — every item below stays unchecked regardless of how
much is built, per this file's own rule (checked only once merged).

- [ ] Migration: `rules`, `rule_runs`, `rule_backfills`, `field_provenance`, `reminders` — done
      (`20260918000000_rules_engine.sql`), plus `connections.rule_backfill_id` and
      `apply_rule_action()`/`claim_rule_backfill_documents()`/`advance_rule_backfill_cursor()`/
      `increment_rule_backfill_progress()`/`complete_rule_backfill()`/`fail_rule_backfill()`/
      `undo_rule_backfill()`. All 27 migrations verified to apply cleanly against the local
      Supabase stack (`supabase db reset --local`); `check-rls-coverage.ts` passes.
      `apply_rule_action()` (idempotent `connect_entity`, field-write provenance recording, atomic
      `rule_runs`+`audit_logs` write per ADR-0008) and `undo_rule_backfill()` (scoped strictly to
      `rule_backfill_id`, never a bare `rule_id`, per ADR-0010) verified live against the local
      stack: idempotent re-connect confirmed a no-op, cross-org call correctly rejected (404-style,
      not 403), and undo left a same-rule ongoing-trigger connection untouched while removing only
      the backfill-tagged one. `claim_rule_backfill_documents()`'s cursor pagination
      (`documents.id` order, `document_type_key`/date-range filter) verified live to never
      re-return an already-advanced-past or non-matching row.
- [ ] `src/modules/rules/` — `rules.schemas.ts` (recursive `all`/`any` DSL, action discriminated
      union), `rules.service.ts` (CRUD), `rules.context.ts` (document/entity subject builders —
      document.content/tags/correspondent/custom fields fetched live from Paperless, degrading to
      `paperlessAvailable: false` rather than throwing), `rules.evaluator.ts` (pure
      `evaluateConditions()`, full `conditions_trace`), `rules.dispatcher.ts` (action application,
      field-conflict claims map, user-edit-wins check via `field_provenance`),
      `rules.delegation.ts`, `rules.actions.ts`. 17 unit tests for the evaluator (every operator,
      `all`/`any` nesting, trace correctness, a pathological `(a+)+$` regex confirmed non-hanging).
- [ ] **Real, session-verified correction to the plan as originally written**: delegating an
      all-Paperless-native rule to a real Paperless workflow (as `specs/07-rules-engine.md`
      describes) is **not implemented** — `docs/adr/0006-disable-paperless-workflow-delegation.md`
      already locked this decision before this session started (missed during initial planning,
      caught by checking the ADR directory properly and independently re-confirmed live this
      session against the pinned instance's own OpenAPI schema: `Workflow`/`WorkflowTrigger` have
      no owner/tenant-scoping field at all, so a delegated workflow would fire on every tenant's
      matching documents, not just the owning tenant's — confirmed by actually creating and
      inspecting a real workflow object via the API, not just reading docs). `rules.delegation.ts`
      exists per the ADR's own "remain in the codebase for forward compatibility" wording but
      always returns `delegated: false` — every rule evaluates locally, unconditionally.
- [ ] Trigger wiring — `document.ingested`/`document.updated` from
      `sync-paperless-document.ts` (now distinguishes insert-vs-update via a pre-upsert existence
      check, firing `updated` only when `document_type_key`/`document_date` actually changed —
      previously always fired `ingested`, which this session corrected as part of building this);
      `document.connected` from `connections.service.ts`'s `createConnection()`/
      `bulkCreateConnections()` (depth 0) and `worker/jobs/run-rule.ts`'s own cascade re-enqueue
      (depth + 1) after a rule's own `connect_entity` action applies; `entity.created` from
      `entities.service.ts#createEntity()`. Cascade cap (3, `rulesConfig.maxCascadeDepth`) checked
      at the top of every `run-rule` job.
- [ ] Conflict resolution — first-writer-wins via an in-memory claims map built once per
      trigger fire in `worker/jobs/run-rule.ts`, shared across every rule evaluated for that
      document; a later rule's write to an already-claimed field records
      `skipped_conflict:<winning-rule-id>` instead of overwriting.
- [ ] `field_provenance` mechanism — implemented; user-edit-wins is checked via
      `rules.dispatcher.ts#isUserOwned()` before every Paperless-side field write. The
      "check Paperless document history for a user edit" half of the spec's own suggested
      mechanism (reusing the existing `getPaperlessDocumentHistory()` from Phase 2 to mark a field
      `updated_by: 'user'` after an out-of-band edit) is **not yet wired** — currently only a rule
      action itself ever writes `field_provenance`, so a raw Paperless-side edit made outside this
      app isn't yet detected. Tracked as a real, open gap, not silently assumed done.
- [ ] `POST /rules/:id/test` — `testRuleAction()` (Server Action per ADR-0009's "rule CRUD"
      allocation), dry run only, no `rule_runs` row written.
- [ ] `src/lib/safe-regex.ts` — `re2` (RE2 engine, linear-time by construction; added as a new
      dependency, npm install verified clean) rather than a `worker_thread` timeout harness, per
      explicit decision this session. Confirmed live (both in the unit test and a standalone
      script) that `(a+)+$` against a 40-character pathological string returns in ~3ms, not a
      hang.
- [ ] `reminders` table + `worker/jobs/fire-due-reminders.ts` — done, registered as a 5-minute
      `upsertJobScheduler()` sweep in `worker/index.ts` (same pattern as
      `expire-abandoned-uploads.ts`). Delivery reuses the existing `createNotification()`, no new
      task system.
- [ ] `worker/jobs/backfill-rule.ts` — done: dry-run count (`previewRuleBackfillAction`), chunked
      via cursor pagination (not a claim-table pattern like imports — see the migration's own
      comment for why), pausable/resumable/cancelable via
      `src/lib/rules/backfill-control.ts` (Redis flag, mirrors `src/lib/import/control.ts`),
      self-perpetuating re-enqueue, undo via `rule_backfill_id` scoping (verified live, see above).
      `GET /api/rule-backfills/[id]/route.ts` for progress polling (ADR-0009).
- [ ] Docs updated — this entry; `SPEC_TRACEABILITY.md`/`DATABASE.md`/`MODULES.md`/
      `API_REFERENCE.md`/`ARCHITECTURE.md` **not yet updated** for Phase 4 — tracked as open.
- [ ] **Not built this session, tracked as open**: the rules/backfill UI (`/dashboard/rules`,
      condition-trace viewer, backfill progress/undo controls — `rules` feature flag stays `false`
      until it exists, so nothing half-built is exposed), `e2e/isolation.spec.ts` additions for
      rules, a real end-to-end run against the live Paperless + Supabase Cloud stack (everything
      above was verified against the local Supabase stack + the pinned Paperless container's real
      schema, not Cloud), and the 5,000-document backfill scale test from the spec's own
      definition-of-done item 3.
- [ ] **Phase 4 exit criteria met** — not met; see the open items above.

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
