# ADR-0013: Defer deduplicating middleware/page session verification

## Context

Investigating a reported 4-5 second load time on the document detail page (Phase 2 Milestone 5,
2-3 documents in the tenant — not a data-volume problem), real server-side timing instrumentation
found the cost was structural, not document-specific:

- `src/proxy.ts` (Next.js 16's renamed `middleware.ts`) calls `updateSession()`
  (`src/lib/supabase/middleware.ts`), which calls `supabase.auth.getUser()` — a real network
  round trip to Supabase Auth to verify the JWT — on **every** request except static assets.
  Measured: ~400-500ms.
- Every page then calls `requireUser()` → `getCurrentUser()`, which calls
  `supabase.auth.getUser()` **again** — a second, independent verification of the same session,
  in the same request. Measured: ~1.1-1.2s (slower than middleware's own call in this sample —
  plausibly connection/pool variance, not a fixed cost).

Together these two calls were the single largest cost on the page, larger than all of the
document-specific data fetching combined. This isn't unique to documents — every authenticated
page in the app pays both costs, since `src/app/(dashboard)/layout.tsx` and every page under it
independently call into this same chain.

Fixing the document-specific redundancy in this session's own new code (merging
`getDocument()`/`getDocumentHistory()`, dropping an unnecessary `getActiveOrganizationId()` call
by deriving `organization_id` from the already-RLS-scoped document row, deduplicating
`getCurrentUser()`/`getCurrentProfile()`/`getActiveOrganizationId()` within a single request via
React's `cache()`) took the page from ~3.6s to ~2.5s, measured. The remaining ~2.5s is dominated
by the middleware-vs-page double session check plus genuine Supabase Cloud network latency
(simple single-row queries measured at 400-800ms each) — neither of which this session's fix
touches.

## Decision

**Defer** eliminating the middleware/page double session-verification. Continue with the current
"middleware refreshes+verifies, every page independently re-verifies via `getCurrentUser()`"
pattern for the rest of Phase 2 (Level 1).

The fix itself is well-understood and not exotic: middleware already runs `getUser()`
successfully before any page renders, so it could attach a verified signal (e.g. a header set
on the outgoing request/response, read by `getCurrentUser()` in place of re-calling
`supabase.auth.getUser()`) that pages trust instead of re-verifying. This is a standard pattern,
not a novel one. It's declined *for now*, not because it's wrong.

## Alternatives considered

- **Implement the header-based trust boundary immediately.** Rejected for this session
  specifically: it changes how every authenticated page in the app establishes trust in the
  current user, not just the documents page that prompted the investigation. Per this project's
  own standing instruction to be conservative and flag security implications for auth-adjacent
  changes rather than silently simplifying them, this needs a deliberate review of the trust
  boundary (what exactly middleware guarantees, how a forged header is prevented, whether every
  page's `getCurrentUser()` call site is safe to point at a header instead of a live check) — not
  something to fold into a performance-bug-fix turn.
- **Switch `getUser()` to `getSession()` everywhere.** Rejected: `getSession()` trusts the
  client-supplied cookie's decoded contents without revalidating against the Auth server, which
  is the exact tradeoff Supabase's own SSR guidance warns against for server-side authorization
  decisions. Faster, but a real weakening of the auth check, not a structural dedup — a different
  kind of change than this ADR is about.
- **Do nothing, treat 2.5s as acceptable.** Rejected — the user's ask was explicit: document
  actions should be close to instant, matching the feel of using Paperless directly (self-hosted,
  local network) rather than a page that visibly waits on multiple remote round trips. The
  structural fixes in this session address the document-specific portion of that; the
  middleware/page dedup addresses the largest remaining portion but is out of scope for a
  same-session fix given the trust-boundary concern above.

## Consequences

- Every dashboard page — not just documents — still pays two session-verification round trips
  per request. This is the single largest lever left for "instant" page loads across the whole
  app, larger than any per-feature optimization.
- **Revisit after Phase 2 (Level 1) closes out.** When picked up, scope it as its own reviewed
  change: define exactly what middleware guarantees by the time a page runs, how the trust
  signal is carried (header name, where it's stripped from client-supplied requests so it can't
  be forged), and update `getCurrentUser()`/`requireUser()` (and anywhere else that independently
  calls `supabase.auth.getUser()`) together, not piecemeal per page.
- Baseline Supabase Cloud network latency (400-800ms per simple query, measured) is a separate,
  likely-unfixable-at-the-app-layer cost worth keeping in mind when this is revisited — even
  after the dedup, a document page will still do several sequential round trips (auth, document
  row, connection/history fan-out) that a self-hosted/local-network comparison like Paperless
  doesn't pay. If "instant" remains the bar after the dedup lands, the next lever is reducing the
  *number* of sequential round trips further, not just deduplicating the ones that exist today.
