# ADR-0002: Single repo + worker entrypoint over a monorepo

## Context

`specs/01-architecture.md`'s repository layout is a monorepo: `apps/web`, `apps/worker`,
`packages/db`, `packages/paperless`, `packages/rules`, `packages/shared`, in a `pomocnik/` repo,
plus a separate `pomocnik-infra` repo for deployment. The actual boilerplate is a single
Next.js repo with a feature-module convention (`src/modules/<name>/{service,actions,schemas}.ts`).
Pomočnik needs a background worker (BullMQ consumers for provisioning, uploads, rules, imports,
reconciliation) that doesn't exist in the boilerplate at all — this is the one place the spec's
structural assumption and the boilerplate's actual structure genuinely diverge, and it had to be
resolved before writing any queue code.

## Decision

Stay in a single Next.js repo. Add a `worker/` entrypoint (plain Node/tsx scripts) as a sibling
to `src/`, sharing the same `package.json`/`tsconfig.json`. Worker code imports the exact same
`src/modules/**/*.service.ts` and `src/lib/**` code the Next.js app uses, and runs as a separate
Docker container/process (`Dockerfile.worker`). `infra/` (docker-compose, nginx, scripts) also
stays inside the main repo rather than becoming a separate `pomocnik-infra` repo.

## Alternatives considered

- **Full monorepo restructure per spec** (`apps/web`, `apps/worker`, `packages/*`). Rejected:
  this is a large structural change unrelated to any actual product requirement, done before any
  product code exists. It would require npm/pnpm workspace tooling the boilerplate doesn't use,
  and would break the existing `service.ts`/`actions.ts` module convention's simplicity (every
  cross-module import currently just works via relative paths within one `src/`).
- **A genuinely separate worker repo/package**, sharing code via a published internal package.
  Rejected: adds a publish/version step for every shared change during a solo-developer MVP
  build, for no isolation benefit a single repo doesn't already provide (the worker is a
  deployment concern — a different container — not a different codebase).

## Consequences

- `service.ts` functions that need to run in both the Next.js request path and the worker must
  not depend on request-only primitives (see ADR-0007, `ServiceContext`) — this constraint
  exists specifically because the worker isn't a separate app with its own request lifecycle.
- One `package.json`, one `tsconfig.json`, one lint/typecheck/test run covers both the app and
  the worker — simpler CI, at the cost of the worker and the app not being independently
  versioned or deployed without a full-repo build.
- If Pomočnik later needs genuinely independent scaling/deployment of app vs. worker beyond what
  "two Docker Compose services from one build" gives, revisit this ADR rather than silently
  drifting toward a monorepo.
