# ADR-0009: Route Handlers vs. Server Actions allocation for the REST contract

## Context

`specs/03-api.md` specifies a REST/JSON contract — base path `/api`, a response envelope
(`{data, meta}` / `{error}`), an error-code taxonomy, `Idempotency-Key` support, cursor
pagination, and per-scope rate limits — written as though the product exposes a conventional
public HTTP API. The boilerplate's own `docs/ARCHITECTURE.md` states a different, already-
established principle: "There is no separate API layer: Server Actions and Route Handlers *are*
the API." Every existing module uses Server Actions for form-driven mutations and Route Handlers
only where something genuinely needs to be fetched as plain HTTP (`src/app/api/files`,
`src/app/api/health`, `src/app/api/webhooks`). Building `specs/03-api.md`'s full route table as
literal REST endpoints would mean maintaining two parallel implementations of every mutation
(a Server Action for the UI, a Route Handler for the "real" API) — the spec doesn't actually
require an external API surface for Level 0/1; it requires the *behavior* (idempotency, error
codes, pagination, envelopes) to exist somewhere consistent.

## Decision

Each `specs/03-api.md` route is allocated to one of two mechanisms, both built on the same
underlying `service.ts` functions, error taxonomy (`src/lib/errors.ts`), and pagination
(`src/lib/pagination.ts`) — never a third, separate implementation:

- **Route Handler** (`src/app/api/**/route.ts`) for anything a client fetches as plain HTTP
  rather than submitting as a form: document preview/download, the internal Paperless webhook,
  `/admin/health`, job-status polling (import/export/bulk-action progress), export file
  downloads, and the unified `/search` endpoint (called via `fetch` from client-side table/
  search UI, not a form submission).
- **Server Action** (`src/modules/*/**.actions.ts`) for everything else — entity/connection/
  rule/import CRUD, bulk action triggers, saved-view management — matching every existing
  module's pattern.

Both mechanisms return the same response envelope and map errors through the same
`AppError` subclasses, so the *contract* in `specs/03-api.md` (error codes, pagination shape,
idempotency semantics) is honored identically regardless of which mechanism serves a given
route — only the transport differs.

## Alternatives considered

- **Build every route in `specs/03-api.md` as a literal Route Handler.** Rejected: doubles the
  implementation surface for every mutation (a Route Handler plus, in practice, a Server Action
  still needed for the actual UI forms, since Server Components/Actions are this app's rendering
  model), for a public API surface nothing in Level 0/1 actually consumes externally.
- **Keep everything as Server Actions, including things fetched via polling/preview.** Rejected:
  Server Actions aren't addressable by a plain `<a href>`/`fetch` the way a download or preview
  link needs to be, and can't be the target of an unauthenticated-but-signed internal webhook
  call from Paperless's post-consume script.

## Consequences

- A future integration need (a real external API for a mobile client or a partner ERP webhook)
  can promote specific Server Actions to Route Handlers later without touching their underlying
  `service.ts` logic — the service layer was already the actual contract boundary.
- `docs/API_REFERENCE.md` documents, per spec route, which mechanism implements it — this
  mapping is the artifact that makes `specs/03-api.md` traceable to real code (see
  `docs/SPEC_TRACEABILITY.md`).
- Document preview specifically is served through our own short-lived signed URL from a Route
  Handler — never a redirect that would expose a Paperless tenant service-user token to the
  browser.
