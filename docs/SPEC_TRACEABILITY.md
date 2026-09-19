# Spec Traceability

One row per spec section, naming the module/table/file(s) that implement it and its current
status. This is what answers "where did requirement X from the spec actually land in code"
without grepping the whole tree. Updated as part of every phase's definition-of-done — a spec
section whose status hasn't moved in a while is a signal to check whether it was forgotten.

Status values: `planned` (designed, not started) · `in progress` · `done` · `deferred` (explicit
decision to build later — must link the reason) · `not applicable` (see `docs/GLOSSARY.md`/ADRs
for a superseding decision).

## specs/00-overview.md — Product scope, locked decisions

| Item | Implementation | Status |
|---|---|---|
| D1–D7 locked decisions | Honored throughout; deviations only where explicitly documented in `docs/adr/` | in progress |
| Non-goals list | No implementation — tracked negatively; any PR proposing one of these must be rejected per `specs/12-agent-rules.md` | not applicable |

## specs/01-architecture.md — Topology, tenancy, GPL boundary, event bridge

| Item | Implementation | Status |
|---|---|---|
| Topology / repo layout | `docs/adr/0002-single-repo-worker-entrypoint.md`, `infra/docker-compose.yml` | done |
| GPL boundary (D3) | `src/lib/paperless/**` is the only Paperless caller; no Paperless source in-repo | done (technical boundary); legal review pending — `RELEASE_PLAN.md` §9 |
| Tenancy model / provisioning | `src/modules/tenants/provision-tenant.ts`, `worker/jobs/provision-tenant.ts` | done |
| Paperless integration client | `src/lib/paperless/{client,documents,fields,tags,workflows,types,errors}.ts` | done |
| Event bridge (post-consume) | `src/app/api/internal/paperless/document-consumed/route.ts` | done — route + HMAC verified; kill-and-recover drill still to run (`RELEASE_PLAN.md` B9) |
| Reconciliation sweep | `worker/jobs/reconcile-incremental.ts`, `worker/jobs/reconcile-full-sweep.ts` | done |
| Upload flow | `src/modules/documents/**`, `worker/jobs/{validate-upload,submit-upload-to-paperless,sync-paperless-document}.ts` | done |

## specs/02-data-model.md — Postgres schema

| Item | Implementation | Status |
|---|---|---|
| `orgs` extension columns | `supabase/migrations/<ts>_documenti_orgs_extension.sql` | done |
| `tenant_paperless_config`, `paperless_object_map` | `supabase/migrations/<ts>_paperless_linkage.sql` | done |
| `entity_types` | `supabase/migrations/20260826000000_tenant_provisioning.sql`, `src/modules/entity-types/` | done |
| `entities`, `entity_identifiers` | `supabase/migrations/20260914000000_entities_connections_fields_views.sql`, `src/modules/entities/` | done |
| `documents` mirror | `20260828000000_document_uploads.sql` | done |
| `connections` | Same migration as entities; `src/modules/connections/connections.service.ts#getConnections()`. Isolation gap found+fixed: `assertBelongsToOrg()` rejects a source/target id from another org (isolation test #9) | done |
| `custom_field_defs` | Same migration; decision-rule enforced as runtime assertion in `src/modules/custom-fields/custom-field-defs.service.ts` | done |
| `background_operations` (not in spec) | `20260914120000_background_operations.sql` — progress tracking for bulk actions + export, mirroring `document_uploads`' RLS pattern | done |
| `rules`, `rule_runs` | Phase 4 migration; `src/modules/rules/` | done |
| `rule_backfills` (not in spec) | [ADR-0010](adr/0010-per-backfill-undo-scope.md) | done |
| `import_jobs`, `import_rows`, `import_mappings` | `20260915112736_phase3_import_foundation.sql` + `20260916090000_import_bulk_write_functions.sql` (`bulk_update_import_rows`, `increment_import_job_progress`); `src/config/imports.ts`, `src/modules/imports/` | done — schema, services, worker and M8 UI built; live CSV wizard verification added |
| `ai_runs`, `ai_corrections`, `ai_budgets` | Level 2 — out of scope for this plan | deferred (Level 2, `specs/08-level-2-ai.md`) |
| `saved_views` | `src/modules/saved-views/` — five starter views lazily seeded on first visit | done |
| `audit_events` | Mapped to `audit_logs` — see [ADR-0005](adr/0005-extend-audit-logs-over-audit-events.md) | done |
| Sync/reconciliation drift table | `worker/jobs/reconcile-*.ts` | done (Phase 1) |

## specs/03-api.md — REST contract

| Item | Implementation | Status |
|---|---|---|
| Route → mechanism allocation | [ADR-0009](adr/0009-route-handlers-vs-server-actions.md); per-route mapping in `docs/API_REFERENCE.md` | done |
| Response envelope / error taxonomy | `src/lib/errors.ts` extended | done |
| Pagination | `src/lib/pagination.ts` reused; new cursor shapes documented per endpoint where needed | done — keyset cursors plus numbered pagination RPC for the documents list |
| Rate limits | Per-org limiter in `src/lib/paperless/client.ts`; app-level limits TBD per route | in progress — per-org Paperless limiter done; app-level per-route limits use `src/lib/ratelimit` (`memory` mode, single instance) |

## specs/04-level-0-foundation.md

| Item | Implementation | Status |
|---|---|---|
| Boilerplate audit | This session's audit — see `docs/adr/0001`–`0003` | done |
| Infrastructure (docker-compose) | `infra/docker-compose.yml` | done — `--profile full` clean-checkout boot still unverified (`RELEASE_PLAN.md` §10) |
| Tenant provisioning | `src/modules/tenants/` | done |
| Paperless integration client | `src/lib/paperless/` | in progress |
| Upload pipeline | `src/modules/documents/`, `worker/jobs/*upload*` | done |
| Event bridge + reconciliation | See specs/01 rows above | done |
| Search passthrough | `documents.service.ts` search wrapper | done — `documents.service.ts` listing search |
| Isolation suite | `e2e/isolation.spec.ts` (tests 1–8, 17–20, Phase 1); `e2e/isolation-phase2.spec.ts` (tests 9, 14, 15, Phase 2). Test 16 (export ZIP) deferred — no ZIP-of-originals export was built | done (tests 1–9, 14–15, 17–20); deferred (test 16) |

## specs/05-level-1-structure.md

| Item | Implementation | Status |
|---|---|---|
| Entity types / entities | `src/modules/entities/`, `src/modules/entity-types/` | done |
| Connections | `src/modules/connections/` | done |
| Entity/document pages | `src/app/(dashboard)/dashboard/{documents,entities,entity-types}/` | done |
| Tables / saved views | Filter query params on the documents list + `src/modules/saved-views/` (no separate reusable `data-table.tsx` component was built — each list page renders its own table; revisit if a third list type appears) | done |
| Mixed-filter query scaling weak point ("cap the Paperless id set and paginate carefully... benchmark at 50k documents") | Phase 3 M7: `hasNoConnections` no longer pulls every connection row into memory to build a `NOT IN (...)` list — `list_documents_without_connections()` (`20260916140000_documents_query_perf.sql`) does the whole filtered, paginated query in one indexed statement (`NOT EXISTS`); `entityId` filter no longer calls `getConnections()`'s label-hydrating path for a pure id lookup (`listConnectedIds()`); new `(organization_id, created_at desc, id desc)` and `(organization_id, status, created_at desc)` indexes back the keyset cursor and status filter | done (fix); the spec's own literal 50k-document benchmark run is still Phase 5 scope |
| Bulk actions | `connections.actions.ts#bulkConnectDocumentsAction` + `documents.actions.ts#bulkEditDocumentsAction` + `worker/jobs/bulk-action.ts`; `bulkCreateConnections()` rewritten set-based in Phase 3 M7 (batched ownership + existing-pair checks, one bulk insert, one audit row per call instead of one per connection) to meet the `< 30s` / 500-document target | done |
| Export | `src/modules/exports/`, `worker/jobs/export.ts` — CSV/XLSX row export; ZIP-of-original-files export (spec's explicitly optional add-on) not built | done (row export); deferred (ZIP export) |
| Entity merge | `merge_entities()` Postgres function, `entity-merge.service.ts`, verified live in `e2e/entity-merge.spec.ts` | done |
| Dashboard information architecture (nav, role-gated home) | `src/config/navigation.ts`, `src/modules/dashboard/dashboard.service.ts` | done |

## specs/06-importer.md

| Item | Implementation | Status |
|---|---|---|
| Full pipeline (analyze/map/validate/review/run/report) | `src/modules/imports/imports.service.ts` (analyze/map/validate/run/pause/resume/cancel/retry-failed), `imports.report.ts` (report CSV) | done — M8 wizard (`src/components/imports/`, dashboard import routes), mandatory review acknowledgement, persisted preview/review and separate document-processing counts |
| Three import kinds (entities/documents/metadata_only) | `imports.matching.ts` (shared plan resolution for both dry-run and real execution), `imports.apply.ts` (entity-link/field-write execution, shared between the synchronous path and the deferred post-ingest path) | done — `custom_field` document-matching strategy declined (ADR-0016), `filename`/`checksum`/`paperless_id` implemented |
| Parsing (CSV/TSV/XLSX/ZIP, encoding/delimiter/locale) | `src/lib/import/parse.ts`, `encoding.ts`, `delimiter.ts`, `locale.ts` | done — `.xls` declined (ADR-0015); 44 unit tests against real chardet/iconv-lite/exceljs/yauzl |
| Execution (chunked, retry, rate-limited) | `worker/jobs/run-import-chunk.ts` + `src/modules/imports/run-import-chunk.ts` — self-perpetuating chunk chain, per-org concurrency cap, per-row `attempts` with transient/permanent distinction; rate limiting inherited from Phase 3 M2's per-org token bucket (every Paperless call the chunk executor makes goes through the same `PaperlessClient` M2 already throttled) | done |
| Pause/resume/cancel/retry-failed | `src/lib/import/control.ts` (Redis flag, checked before every chunk claim/reschedule) | done |
| Duplicate handling (skip-but-connect / create_anyway / fail) | `imports.matching.ts#resolveDocumentRowPlans` | done |
| OCR backpressure / per-job completion | A `create_document` row is marked `ok` once `document_uploads` exists and ingestion is enqueued, not once OCR/indexing finishes; entity links/field writes for that row are deferred to `sync-paperless-document.ts` (runs once the document lands in the mirror, well before OCR) | done — verified live |
| Reusable saved mappings | `import_mappings` table, `saveImportMapping()`/`listImportMappings()`, M8 file-step selector and review-step save form | done |
| Encoding override, locale previews, responsive EN/SL UI | `import-mapping.tsx`, `import-workspace.tsx`, `messages/{en,sl}/imports.json`; explicit parser overrides and bounded cursor row pages | done (M8); live CSV wizard and component/parser tests |
| Isolation (import maps to another org's identifier → row error) | Every matching query in `imports.matching.ts` filters by `organization_id`; `on_missing:"fail_row"` now becomes a terminal `ENTITY_NOT_FOUND` plan instead of an executable "ok with failed link" result; `e2e/isolation.spec.ts` test #11 proves no cross-org connection is created | done |
| 10,000-document / 45-minute scale target | `scripts/loadtest-import.ts` builds a ZIP with XLSX manifest and N valid PDFs, uploads it to `import-sources`, and runs the real analyze/map/validate services; `--execute` starts the real worker-backed chunk chain | partially verified — live 10,000-row analyze+validate passed in 43.5s total; full `--execute` run intentionally not started in this pass to avoid flooding Paperless with 10,000 OCR jobs without an explicit operator window |

## specs/07-rules-engine.md

| Item | Implementation | Status |
|---|---|---|
| DSL, evaluation, conditions/actions | `src/modules/rules/rules.service.ts` | done |
| Delegation to Paperless | Disabled — [ADR-0006](adr/0006-disable-paperless-workflow-delegation.md) | not applicable (MVP) |
| Dry run / condition trace | `POST /rules/:id/test` | done — `testRuleAction`, shown as a plain list in the Test tab |
| Backfill + undo | `worker/jobs/backfill-rule.ts`, `rule_backfills` table | done — 5,000-doc `--execute` run still outstanding (`RELEASE_PLAN.md` §7) |
| Field provenance (user-edit protection) | New `field_provenance` mechanism, Phase 4 | done |

## Beyond the spec (built during Level 1 product polish)

| Item | Implementation | Status |
|---|---|---|
| Per-document visibility and sharing (spec assumed org-wide document visibility) | [ADR-0017](adr/0017-per-document-visibility-and-sharing.md), `20260922000000`–`20260925000000` migrations, `src/modules/documents/document-shares.*` | done — deliberate deviation from specs/02 and specs/05 |
| Tenant custom fields and attribute management (tags, correspondents, document types) | `src/modules/attributes/`, `src/modules/custom-fields/`, `/dashboard/attributes/[kind]` | done; document matching on custom fields for imports deferred ([ADR-0016](adr/0016-defer-custom-field-document-matching.md)) |
| Bulk attribute assignment from the documents list | `documents.actions.ts#bulkEditDocumentsAction`, `bulkAssign` messages | done |
| Static and dynamic saved views | `20260920120000_saved_view_static_document_sets.sql`, `src/modules/saved-views/` | done |
| Role-aware dashboard (owner vs member stats) | `20260921000000_dashboard_stats_rpc.sql`, `src/modules/dashboard/` | done |
| EN/SL localisation (`next-intl`) | `messages/{en,sl}/`, `src/i18n/` | done — key parity verified for all 17 namespaces |
| Onboarding flow | `src/app/[locale]/(onboarding)/onboarding` | done |
| Product rename Pomočnik → Documenti | `package.json`, env var `DOCUMENTI_WEBHOOK_SECRET`, `infra/scripts/notify-documenti.sh` | done |

## specs/08-level-2-ai.md, specs/09-level-3-templates.md

Out of scope for this plan (Level 0/1 only). `field_provenance` (Phase 4) and `ServiceContext`
(ADR-0007) are built now specifically so Level 2 can reuse them without rework — see each ADR's
Consequences section.

## specs/10-nonfunctional.md

| Item | Implementation | Status |
|---|---|---|
| Isolation test suite (20 tests) | Split: 1–8, 17–20 in Phase 1 (done); 9, 14, 15 in Phase 2 (done); 16 deferred (no ZIP export built); 11 (import maps to another org's identifier) not yet a dedicated test — every matching query is org-scoped by construction, but no `e2e/isolation-phase3.spec.ts` exists (Phase 3 M9 scope); 10, 12, 13 deferred (rules/AI features, not yet built) | in progress |
| Security table | Threaded through Phase 1 (AV scan, HMAC, encrypted tokens) and Phase 5 (headers, CSP) | in progress — AV scan, HMAC, encrypted tokens done; headers/CSP open (`RELEASE_PLAN.md` B2) |
| Performance targets | Phase 5 load test | planned — `RELEASE_PLAN.md` §7 |
| Backups/restore | Phase 5 restore drill (DB + media) | in progress — one restore drill done in Phase 1; production-layout drill open (B4) |
| GDPR | Phase 5 documentation (DPA, subprocessors) | planned — `RELEASE_PLAN.md` §9 |

## specs/11-roadmap.md, specs/12-agent-rules.md

Followed as process, not implemented as code — see `docs/adr/README.md` for how ADR discipline
implements the spirit of "stop and escalate" / "document deviations" from `specs/12`.
