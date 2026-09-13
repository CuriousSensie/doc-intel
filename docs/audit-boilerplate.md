# Boilerplate audit

`specs/04-level-0-foundation.md` asks for this before writing any Pomočnik code, as a gate: does
the existing MVP boilerplate's multi-tenancy/RBAC/auth/jobs/storage/migration/secrets story
already fit Pomočnik's requirements, or does something need replacing before building on it. This
was answered incrementally as ADRs during the actual build rather than as a single upfront
document — this consolidates those findings into the one place the spec asks for, citing the ADR
or code that backs each answer rather than re-arguing it.

**Bottom line: extend, don't replace.** No boilerplate primitive failed this audit outright. The
locked decision this audit exists to protect — "don't refactor the boilerplate for cleanliness" —
held for all eight questions below.

| Question | Answer | Evidence |
|---|---|---|
| Does every tenant-scoped query already derive `org_id` server-side? | Yes. The active organization is resolved from the session/cookie server-side (`getActiveOrganizationId()`) and never accepted from the client — every route handler that creates a tenant-scoped row resolves it this way, not from a request body field. | `src/modules/organizations/active-organization.ts`; `src/app/api/documents/upload-intent/route.ts`'s own comment: "org_id is never accepted from the client — the active org is resolved server-side from the session, same as every other org-scoped route in this codebase" |
| Is RLS enabled, or is scoping application-only? | RLS, not application-only — and CI-enforced, not just convention. Every tenant-scoped table needs a leading `organization_id` index, RLS enabled, and at least one policy, or the build fails. | `scripts/check-rls-coverage.ts` (wired into `.github/workflows/ci.yml`) |
| What is the role model? | `organization_role` enum: `owner`, `admin`, `member`, `read-only` — exactly Pomočnik's stated minimum. `read-only` didn't exist in the original boilerplate; added via `protect_system_columns()`'s migration, along with `has_organization_write_access()` to exclude it from the one write-capable policy that previously keyed off plain membership. | `src/types/database.ts`'s `organization_role`; `supabase/migrations/20260824000000_pomocnik_orgs_extension.sql` |
| Is there a background job system? | Yes — BullMQ, not fire-and-forget, running in a dedicated `worker` process/container sharing this repo rather than a separate service. **Real gap found and fixed this session**: no queue anywhere had a retry policy configured (BullMQ's default is `attempts: 1`), so a single transient failure (e.g. one dropped connection to Paperless) permanently failed a job despite every job's own resumability design assuming a retry would happen. Fixed with a queue-wide `defaultJobOptions` (3 attempts, exponential backoff). | [ADR-0002](adr/0002-single-repo-worker-entrypoint.md); `src/lib/queue/index.ts` |
| Where is file storage? | Supabase Storage — private buckets (`avatars`, `files`, `document-uploads`), not S3-compatible-separately or Vercel Blob. Documents go direct-to-storage via a signed upload URL the browser PUTs to directly (bypassing the app server for the file bytes themselves), not buffered through a Route Handler. | `supabase/migrations/20260822090000_files_storage.sql`, `20260828000000_document_uploads.sql`; `src/modules/documents/documents.service.ts`'s `createUploadIntent()` |
| Any Vercel-specific primitives? | None found — no Vercel Blob, KV, edge middleware, or ISR anywhere in the boilerplate. This matters because D4 locks Pomočnik to a single VPS via `docker-compose`, not Vercel; had the boilerplate leaned on Vercel-only primitives, D4 would have forced ripping them out first. It didn't. | [ADR-0003](adr/0003-supabase-cloud-over-self-hosted.md); `infra/docker-compose.yml` |
| Migration tooling | Native Supabase CLI migrations (plain, hand-written SQL files under `supabase/migrations/`), not Drizzle. Evaluated and explicitly declined switching, not just left alone by default. | [ADR-0001](adr/0001-native-supabase-over-drizzle.md) |
| How are secrets managed? | Plain `.env` files for application config/credentials (Supabase service role key, SMTP, Stripe) — no secrets-manager integration in the boilerplate, and Pomočnik doesn't add one. What's new: a tenant's Paperless API token is additionally encrypted at rest (AES-256-GCM) before being stored in `tenant_paperless_config.api_token_encrypted`, since unlike the app's own service credentials, a leaked Paperless token would grant direct access to that tenant's real documents in a system outside our own RLS. | `src/lib/paperless/token-crypto.ts`; `supabase/migrations/20260825000000_paperless_linkage.sql` |

## What this audit did *not* need to answer

The original question list assumes the boilerplate might lack a background job system, RLS, or a
role model rich enough for Pomočnik — none of that was true. The one real gap this audit
surfaced (queue retries) was a genuine correctness bug, not a missing primitive: the *system*
existed and was structurally sound, one of its defaults just didn't match what every job's own
code already assumed about it. That's the kind of finding worth writing down here — a
boilerplate audit's job is to catch exactly this class of "the pieces are all there, but does the
default behavior actually hold" gap, not just "is there a folder for X."
