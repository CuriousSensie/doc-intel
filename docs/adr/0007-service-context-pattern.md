# ADR-0007: `ServiceContext` pattern for request/worker-shared service functions

## Context

The existing module convention (`docs/ARCHITECTURE.md`) is that `service.ts` functions are
"plain async functions you could call from a script, a cron job, or another module." In
practice, every current `service.ts` (e.g. `src/modules/organizations/organizations.service.ts`)
constructs its own Supabase client internally by calling `createClient()` from
`src/lib/supabase/server.ts`, which calls Next.js's `cookies()` to read the request's session —
a function that only works inside a Next.js request/response lifecycle (a Server Component,
Server Action, or Route Handler). ADR-0002 puts BullMQ job handlers in `worker/jobs/*.ts`,
running as a plain Node process with no HTTP request, no cookies, and no user session at all.
Any new Pomočnik service function that needs to run from both a Server Action *and* a worker job
(tenant provisioning, document ingestion, rule evaluation, import row processing) cannot use
`createClient()` internally — this was discovered as a concrete blocker during plan review, not
a hypothetical.

## Decision

New service functions that must run in both contexts take an explicit `ServiceContext` as their
first parameter instead of resolving a client internally:

```ts
type ServiceContext = {
  db: SupabaseClient;       // RLS client (request) or admin client (worker)
  orgId: string;
  actorId: string | null;   // null for system/rule/import-triggered actions
  correlationId: string;
};
```

`src/lib/service-context.ts` exports `buildRequestContext()` — wraps `requireUser()` +
`getActiveOrganizationId()` + the RLS client from `src/lib/supabase/server.ts` — for Server
Action/Route Handler callers. `worker/context.ts` exports `buildJobContext()` — builds the same
shape from a BullMQ job's payload (`orgId`, a generated `correlationId`) and the **admin**
Supabase client, since a worker has no user session to scope an RLS client by.

## Alternatives considered

- **Give the worker its own Supabase client that fakes a session/cookie.** Rejected: there's no
  real user session to fake for a system-triggered job (reconciliation, rule backfill), and
  faking one would be worse than being honest that worker code runs with elevated (admin)
  privilege and must do its own explicit org-scoping in every query, the same way
  `paperlessAdminClient()` already requires deliberate, restricted use (ADR pending on that
  restriction — see `src/lib/paperless/client.ts`'s lint rule).
- **Duplicate service logic** — one version for Server Actions (using `createClient()`
  internally), a separate version in `worker/jobs/*.ts` reimplementing the same logic against
  the admin client. Rejected: this is exactly the "second implementation of the same logic"
  pattern the codebase's module convention exists to avoid, and guarantees drift between the two
  copies over time.
- **Only ever queue-and-forget from Server Actions, keep all real logic worker-only** (Server
  Actions become thin enqueue calls, nothing else). Rejected as the default: many operations
  (synchronous validation, dry-run rule tests, reads) have no reason to go through a queue and
  should stay fast, in-request. `ServiceContext` lets the same function serve both without
  forcing everything through the queue.

## Consequences

- Existing modules (`organizations`, `billing`, `files`, etc.) are **not** retrofitted to this
  pattern — they only ever run in the request context and `createClient()` continues to work
  fine for them. `ServiceContext` is adopted only where a function genuinely needs to run in
  both places, avoiding an unnecessary rewrite of working code.
- Every new Pomočnik module (`tenants`, `documents`, `entities`, `connections`, `rules`,
  `imports`) is written against this pattern from the start, since all of them have a
  worker-triggered path (provisioning, ingestion, rule evaluation, import execution) alongside
  their UI-triggered path.
- Worker-context calls always use the admin client — every such service function must do its own
  explicit `organization_id` filtering in every query it issues, since RLS won't scope it. This
  is a real responsibility, not a formality; a query missing an `organization_id` filter in a
  worker-context function is a cross-tenant leak with no RLS net underneath it.
