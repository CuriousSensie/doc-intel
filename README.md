# Documenti

Document intelligence for Slovenian businesses: a multi-tenant SaaS that puts a business layer
(entities, connections, imports, rules, saved views) on top of Paperless-ngx as the document engine.
Level 0 (foundation) and Level 1 (structure) are feature-complete; AI (Level 2) and templates
(Level 3) are not started. Current focus: the first production release, see
[docs/RELEASE_PLAN.md](docs/RELEASE_PLAN.md).

Built on Next.js (App Router), Supabase (Postgres/Auth/Storage, RLS-first), Paperless-ngx, BullMQ +
Redis, Stripe and SMTP email, in TypeScript. UI is English and Slovenian (`next-intl`).

## Read this first

1. [specs/00-overview.md](specs/00-overview.md) — scope, non-goals and the locked decisions D1–D7.
2. [specs/12-agent-rules.md](specs/12-agent-rules.md) — the working rules (never do / always do /
   definition of done / when to escalate). The specs are the binding design; `docs/` records what was
   actually built and every deviation.
3. [CLAUDE.md](CLAUDE.md) — project conventions for AI agents (also useful for humans).

## Documentation map

| Doc | Read this when you want to... |
| --- | --- |
| [docs/RELEASE_PLAN.md](docs/RELEASE_PLAN.md) | Ship it: readiness, blockers, environment checklist, staging rehearsal, deploy runbook, rollback, monitoring |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | See what is built, phase by phase, and what evidence backs it |
| [docs/SETUP.md](docs/SETUP.md) | Run it locally: Supabase, Stripe, email, Paperless/worker Docker Compose |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Understand request flow, module layout and key design decisions |
| [docs/DATABASE.md](docs/DATABASE.md) | Look up a table, policy, function or migration |
| [docs/MODULES.md](docs/MODULES.md) | Understand what a module does and how to extend it |
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md) | Find the signature of a service, action or route |
| [docs/SECURITY.md](docs/SECURITY.md) | Auth model, RLS, tenant isolation, document visibility |
| [docs/SPEC_TRACEABILITY.md](docs/SPEC_TRACEABILITY.md) | Map a spec section to the code that implements it |
| [docs/adr/](docs/adr/README.md) | Why a decision was made, including declined alternatives |
| [docs/GLOSSARY.md](docs/GLOSSARY.md) | Spec term ↔ code term |
| [docs/spike-findings.md](docs/spike-findings.md) | What the Phase 0 de-risking spikes found about Paperless |

## What it does (Level 1)

Documents (upload, OCR via Paperless, search, sharing) · Entities and entity types · Connections
between documents and entities · Imports (CSV/TSV/XLSX/ZIP) · Rules engine (deterministic, with dry
run, backfill and undo) · Saved views (dynamic and static) · Attributes (tags, correspondents,
document types, custom fields) · Exports (CSV/XLSX) · Role-aware dashboard · Organizations, roles and
invitations · Billing (Stripe) · Notifications · Admin.

Tenant isolation is the core guarantee: no tenant can see another's data, enforced by Supabase RLS
and per-tenant Paperless ownership, and proven by the isolation suite (`e2e/isolation*.spec.ts`).

## Project structure

```
src/
  app/[locale]/             Routes: (marketing) (auth) (onboarding) (dashboard) (admin)
  app/api/                  Route handlers: documents, exports, imports, rule-backfills, search,
                            health, Stripe webhook, internal Paperless webhook
  modules/                  Domain logic, one directory per module (documents, entities,
                            connections, rules, imports, saved-views, attributes, custom-fields,
                            dashboard, exports, billing, organizations, ...)
  lib/                      Infrastructure: paperless client, supabase clients, queue, rules
                            support, import parsing, events/audit, env, errors
  config/                   Typed static config: features, navigation, billing, rules, imports
  components/               Shared UI
  i18n/, messages/{en,sl}/  next-intl setup and message files
worker/                     BullMQ worker entrypoint and jobs (separate process, shares src/)
supabase/migrations/        Forward-only SQL migrations (RLS and indexes ship with each table)
infra/                      docker-compose.yml, nginx, Paperless event-bridge script
scripts/                    check-rls-coverage.ts (CI), loadtest-import.ts, loadtest-rule-backfill.ts
e2e/                        Playwright specs, including the tenant isolation suite
specs/, docs/               Binding spec; as-built documentation and ADRs
```

## Quick start (local)

```bash
npm install
cp .env.example .env                       # fill in Supabase (and Stripe/SMTP if needed)
cd infra && cp .env.example .env           # fill in Paperless + secrets, then:
docker compose --profile paperless up -d
docker compose --profile full up -d redis-app clamav
cd .. && npm run dev                       # web on http://localhost:3000
npm run worker:start                       # worker, in a second terminal (required)
```

Full walkthrough, including Supabase migrations and the all-Docker `--profile full` path, is in
[docs/SETUP.md](docs/SETUP.md).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm run start` | Production build (`next build --webpack`) / serve it |
| `npm run worker` / `npm run worker:start` | Worker with file watching / plain |
| `npm run lint` · `npm run typecheck` | ESLint · `tsc --noEmit` |
| `npm test` · `npm run test:watch` | Vitest, once · watch |
| `npm run test:e2e` | Playwright (needs live Supabase + Paperless, see CI) |
| `npm run format` · `npm run format:write` | Prettier check · apply |
| `npx tsx scripts/check-rls-coverage.ts` | Fails if a tenant table lacks its `organization_id` index or RLS policy |
| `npx tsx --env-file=.env scripts/loadtest-import.ts --rows 10000` | Import scale harness (`--execute` runs it for real) |
| `npx tsx --env-file=.env scripts/loadtest-rule-backfill.ts --docs 5000` | Rule backfill scale harness (`--execute`) |

The bar for any change: `lint`, `typecheck`, `test`, `build`, the RLS coverage check, and the isolation
suite pass (`specs/12-agent-rules.md`).
