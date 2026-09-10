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
| Topology / repo layout | `docs/adr/0002-single-repo-worker-entrypoint.md`, `infra/docker-compose.yml` | planned |
| GPL boundary (D3) | `src/lib/paperless/**` is the only Paperless caller; no Paperless source in-repo | planned |
| Tenancy model / provisioning | `src/modules/tenants/tenants.service.ts`, `worker/jobs/provision-tenant.ts` | planned |
| Paperless integration client | `src/lib/paperless/{client,documents,fields,tags,workflows,types,errors}.ts` | planned |
| Event bridge (post-consume) | `src/app/api/internal/paperless/document-consumed/route.ts` | planned |
| Reconciliation sweep | `worker/jobs/reconcile-incremental.ts`, `worker/jobs/reconcile-full-sweep.ts` | planned |
| Upload flow | `src/modules/documents/**`, `worker/jobs/{validate-upload,submit-upload-to-paperless,sync-paperless-document}.ts` | planned |

## specs/02-data-model.md — Postgres schema

| Item | Implementation | Status |
|---|---|---|
| `orgs` extension columns | `supabase/migrations/<ts>_pomocnik_orgs_extension.sql` | planned |
| `tenant_paperless_config`, `paperless_object_map` | `supabase/migrations/<ts>_paperless_linkage.sql` | planned |
| `entity_types`, `entities`, `entity_identifiers` | `supabase/migrations/<ts>_entities_and_connections.sql`, `src/modules/entities/` | planned |
| `documents` mirror | Created in Phase 1 upload-pipeline migration (needed before entity tables) | planned |
| `connections` | Same migration as entities; `src/modules/connections/connections.service.ts#getConnections()` | planned |
| `custom_field_defs` | Same migration; decision-rule enforced as runtime assertion in `src/modules/entities/` | planned |
| `rules`, `rule_runs` | Phase 4 migration; `src/modules/rules/` | planned |
| `rule_backfills` (not in spec) | [ADR-0010](adr/0010-per-backfill-undo-scope.md) | planned |
| `import_jobs`, `import_rows`, `import_mappings` | Phase 3 migration; `src/modules/imports/` | planned |
| `ai_runs`, `ai_corrections`, `ai_budgets` | Level 2 — out of scope for this plan | deferred (Level 2, `specs/08-level-2-ai.md`) |
| `saved_views` | `src/modules/saved-views/` | planned |
| `audit_events` | Mapped to `audit_logs` — see [ADR-0005](adr/0005-extend-audit-logs-over-audit-events.md) | planned |
| Sync/reconciliation drift table | `worker/jobs/reconcile-*.ts` | planned |

## specs/03-api.md — REST contract

| Item | Implementation | Status |
|---|---|---|
| Route → mechanism allocation | [ADR-0009](adr/0009-route-handlers-vs-server-actions.md); per-route mapping in `docs/API_REFERENCE.md` | planned |
| Response envelope / error taxonomy | `src/lib/errors.ts` extended | planned |
| Pagination | `src/lib/pagination.ts` reused; new cursor shapes documented per endpoint where needed | planned |
| Rate limits | Per-org limiter in `src/lib/paperless/client.ts`; app-level limits TBD per route | planned |

## specs/04-level-0-foundation.md

| Item | Implementation | Status |
|---|---|---|
| Boilerplate audit | This session's audit — see `docs/adr/0001`–`0003` | done |
| Infrastructure (docker-compose) | `infra/docker-compose.yml` | planned |
| Tenant provisioning | `src/modules/tenants/` | planned |
| Paperless integration client | `src/lib/paperless/` | planned |
| Upload pipeline | `src/modules/documents/`, `worker/jobs/*upload*` | planned |
| Event bridge + reconciliation | See specs/01 rows above | planned |
| Search passthrough | `documents.service.ts` search wrapper | planned |
| Isolation suite | `e2e/isolation.spec.ts` (tests 1–8, 17–20 in Phase 1; 9, 14–16 in Phase 2) | planned |

## specs/05-level-1-structure.md

| Item | Implementation | Status |
|---|---|---|
| Entity types / entities | `src/modules/entities/` | planned |
| Connections | `src/modules/connections/` | planned |
| Entity/document pages | `src/app/(dashboard)/{documents,entities,entity-types}/` | planned |
| Tables / saved views | `src/components/tables/data-table.tsx`, `src/modules/saved-views/` | planned |
| Bulk actions | `documents.actions.ts` + `worker/jobs/bulk-action.ts` | planned |
| Export | `src/modules/exports/`, `worker/jobs/export.ts` | planned |
| Entity merge | `merge_entities()` Postgres function | planned |

## specs/06-importer.md

| Item | Implementation | Status |
|---|---|---|
| Full pipeline (analyze/map/validate/review/run/report) | `src/modules/imports/` | planned |
| Parsing (CSV/TSV/XLSX/ZIP, encoding/delimiter/locale) | `src/lib/import/parse.ts` | planned |
| Execution (chunked, retry, rate-limited) | `worker/jobs/run-import-row.ts` | planned |
| OCR backpressure / per-job completion | Clarifying note in Phase 1 §5 of the implementation plan | planned |

## specs/07-rules-engine.md

| Item | Implementation | Status |
|---|---|---|
| DSL, evaluation, conditions/actions | `src/modules/rules/rules.service.ts` | planned |
| Delegation to Paperless | Disabled — [ADR-0006](adr/0006-disable-paperless-workflow-delegation.md) | not applicable (MVP) |
| Dry run / condition trace | `POST /rules/:id/test` | planned |
| Backfill + undo | `worker/jobs/backfill-rule.ts`, `rule_backfills` table | planned |
| Field provenance (user-edit protection) | New `field_provenance` mechanism, Phase 4 | planned |

## specs/08-level-2-ai.md, specs/09-level-3-templates.md

Out of scope for this plan (Level 0/1 only). `field_provenance` (Phase 4) and `ServiceContext`
(ADR-0007) are built now specifically so Level 2 can reuse them without rework — see each ADR's
Consequences section.

## specs/10-nonfunctional.md

| Item | Implementation | Status |
|---|---|---|
| Isolation test suite (20 tests) | Split: 1–8, 17–20 in Phase 1; 9, 14–16 in Phase 2 | planned |
| Security table | Threaded through Phase 1 (AV scan, HMAC, encrypted tokens) and Phase 5 (headers, CSP) | planned |
| Performance targets | Phase 5 load test | planned |
| Backups/restore | Phase 5 restore drill (DB + media) | planned |
| GDPR | Phase 5 documentation (DPA, subprocessors) | planned |

## specs/11-roadmap.md, specs/12-agent-rules.md

Followed as process, not implemented as code — see `docs/adr/README.md` for how ADR discipline
implements the spirit of "stop and escalate" / "document deviations" from `specs/12`.
