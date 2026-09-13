# Phase 0 spike scripts

Throwaway code that answers the four questions in `specs/11-roadmap.md`'s Phase 0, against a
real Paperless instance brought up via `infra/docker-compose.yml`. Not part of the Next.js
build (see `tsconfig.json`/build config — these are excluded from the app bundle) and not
meant to be maintained long-term; the isolation checks are written so they can be lifted almost
verbatim into `e2e/isolation.spec.ts` in Phase 1.

## Prerequisites

```bash
cd infra
cp .env.example .env   # fill in PAPERLESS_DBPASS, PAPERLESS_ADMIN_*, etc.
docker compose --profile paperless up -d
```

Wait for `paperless-webserver` to report healthy (`docker compose ps`), then from the repo root:

```bash
export PAPERLESS_URL=http://localhost:8010
export PAPERLESS_ADMIN_USER=<from infra/.env>
export PAPERLESS_ADMIN_PASSWORD=<from infra/.env>
```

## Scripts

| Script | Answers | Kill criterion (specs/11-roadmap.md) |
|---|---|---|
| `isolation.ts` | Does the pinned Paperless version enforce object permissions for every class in specs/10-nonfunctional.md's 20 tests? | Any class leaks with no workaround → switch to instance-per-tenant, re-estimate |
| `event-bridge.ts` | Does the post-consume script reliably reach us, and does a reconciliation-style poll recover from a killed bridge? | Script unreliable → sweep-only, accept higher latency |
| `ocr-slovenian.ts <files...>` | Real scanned Slovenian invoices: are č/š/ž correct? Is accuracy usable? | Poor accuracy → evaluate an alternative OCR approach before building on this one |
| `import-throughput.ts` | 1,000 documents end-to-end: measured wall time, CPU, queue behaviour under a second tenant's concurrent use | Unacceptable contention → dedicated OCR workers per large tenant |

Run each with `npx tsx scripts/spike/<name>.ts` from the repo root.

## After running

Write findings into `docs/spike-findings.md` (all four sections) and update
`docs/IMPLEMENTATION_PLAN.md`'s Phase 0 checklist. Any kill-criterion actually hit is escalated
per `specs/12-agent-rules.md` — stop and ask, don't quietly work around a locked decision.
