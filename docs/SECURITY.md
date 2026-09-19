# Security

For the exact RLS policies and indexes referenced throughout this doc, see the per-table
reference in [DATABASE.md](DATABASE.md#tables-reference). For the request-flow diagrams showing
where the RLS-scoped vs. admin client gets used, see [ARCHITECTURE.md](ARCHITECTURE.md#request-flow).

## Core Rules

1. Never trust client-provided user IDs.
2. Derive identity from the authenticated Supabase session.
3. Never expose service-role credentials.
4. Never expose Stripe secrets.
5. Never rely only on frontend authorization.
6. Verify webhook signatures.
7. Use RLS for user-facing tables.
8. Validate external input.
9. Rate-limit abuse-prone endpoints.
10. Prevent duplicate payment and credit processing.
11. Do not log secrets.
12. Protect cross-tenant data.
13. Use secure redirects.
14. Prefer least privilege.
15. Treat external responses as untrusted.
16. Make destructive actions explicit.
17. Handle concurrency in financial and credit operations.

## Service Role

The Supabase service-role key may only be used from server-only modules. Browser clients and Client
Components must use the publishable key with RLS-scoped access.

## Authentication

- OAuth and email links exchange codes only through `/auth/callback`.
- Redirect targets are constrained to local paths.
- Guest-readable auth pages do not require Supabase configuration in a fresh clone.
- Auth mutations fail early if required Supabase credentials are missing.
- TOTP MFA uses Supabase Auth factors and authenticator assurance levels.

## Organizations

RLS enforces that a user can only read/manage rows for organizations they belong to
(`is_organization_member`, `has_organization_role` helper functions), and that an application
admin (`is_app_admin`) can see everything. A few operations can't be expressed as a plain RLS-scoped
query because the actor isn't yet authorized to touch the row they need to create or aren't a
member yet, so they're implemented as SECURITY DEFINER Postgres functions instead (same pattern as
the existing `handle_new_user` trigger):

- `create_organization` — a new org has no members yet, so the creator can't insert their own
  `organization_members` row under the normal owner/admin-only insert policy. The function inserts
  the org and the creator's `owner` membership in one transaction.
- `get_organization_invitation` / `accept_organization_invitation` — the invitee isn't a member and
  has no RLS access to the invitation row by token. `accept_organization_invitation` validates the
  token hash, expiry, revocation, and that the invitation's email matches `auth.email()` before
  inserting the membership and marking the invitation accepted, all in one function so it can't
  half-complete.
- `transfer_organization_ownership` — swaps two members' roles (old owner → admin, new owner →
  owner) atomically; doing this as two separate client-side updates risks a partial transfer if the
  second update fails.
- `update_member_role` / `remove_member` / `leave_organization` — these three *are* expressible as
  plain RLS-scoped mutations (the actor already has update/delete rights via policy), but became
  SECURITY DEFINER functions anyway for a different reason: see [Audit Logs](#audit-logs) below
  for why a permission change specifically needs its audit row written in the same transaction as
  the mutation, not via a separate best-effort `logEvent()` call.

Invitation tokens are generated server-side and only their SHA-256 hash (`token_hash`) is stored;
the raw token exists only in the invite link, never in the database. `digest()` (used to hash the
token inside the SQL functions) lives in the `extensions` schema on Supabase-hosted projects, not
`public` — functions that call it need `set search_path = public, extensions`, otherwise the
function fails with `function digest(text, unknown) does not exist` even though the `pgcrypto`
extension is enabled.

A member can leave an organization (delete their own `organization_members` row) unless they are
the organization's sole remaining owner — enforced directly in the
`organization_members_delete_self` RLS policy, not just in application code, so it holds even if a
future caller bypasses the service layer.

Role-based UI checks in `organizations.actions.ts` (`requireOrgRole`) exist for clear error
messages and are not the security boundary — RLS on `organizations`, `organization_members`, and
`organization_invitations` is what actually prevents cross-tenant access.

## Email

`SMTP_USER`/`SMTP_PASSWORD` (and any future provider's API key) are server-only environment
variables (`src/lib/env.ts`) and are never sent to the browser. `sendEmail()`
(`src/modules/email/email.service.ts`) logs delivery failures via the structured `logger` but only
ever logs the template name, recipient, and error message — never the SMTP credentials or the
raw error object, matching rule 11 (do not log secrets).

Local development defaults to `EMAIL_PROVIDER=console`, which logs the rendered email instead of
sending it, so a fresh clone never emails a real person by accident. `EMAIL_DEV_RECIPIENT`, when
set, reroutes every outgoing email to one inbox regardless of the real recipient — independent of
which provider is active — so real SMTP delivery can be tested in development without emailing
real users.

A failed email send never blocks or rolls back the action that triggered it (e.g. inviting a
member): `sendEmail()` catches its own errors and returns `null` rather than throwing, so the
already-created database row (the invitation) is never left inconsistent with a half-completed
side effect.

## Billing

`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are server-only and never sent to the browser.
`stripe_customers`, `subscriptions`, and `credit_transactions` have **select-only** RLS policies
(owner or admin) — no insert/update policy at all, by design. Every write to these tables goes
through the service-role admin client (`src/lib/supabase/admin.ts`), from either the webhook
handler or the billing/usage/credits service layer, never from a user-scoped client. This means
the RLS layer alone cannot be bypassed by a client-side call to create or edit a subscription —
only trusted server code can.

The webhook handler (`src/app/api/webhooks/stripe/route.ts`) verifies every event's signature via
`stripe.webhooks.constructEventAsync` before touching the database, and is idempotent: each event
is recorded in `webhook_events` keyed by `(provider, event_id)`, and an event already marked
`processed` is skipped on retry rather than reprocessed. Handlers return a 500 on unexpected
errors so Stripe retries automatically; the dedupe check re-reads the event's stored `status`
rather than re-inserting, so retries are safe.

Stripe — not the browser redirect after Checkout — is the source of truth for subscription state.
The Checkout success URL is purely a UI courtesy message; provisioning only happens once the
webhook confirms it.

Two atomic SQL functions exist because plain client-side reads-then-writes cannot safely guarantee
correctness under concurrency (temp.md §64/§17):

- `increment_usage_counter` — a single conditional `INSERT ... ON CONFLICT ... WHERE quantity +
  amount <= limit`, so a burst of concurrent requests can't collectively exceed a plan's usage
  limit. It also replaces `usage_counters`' original composite unique constraint (which included
  nullable owner columns Postgres never treats as equal to each other) with two partial unique
  indexes — see the migration for details.
- `consume_credits` — `credit_transactions` is a pure ledger with no mutable balance column, so
  checking "is there enough balance" and inserting the debit must happen atomically. The function
  takes a per-owner Postgres advisory lock (`pg_advisory_xact_lock`, released automatically at the
  end of the transaction) before summing the ledger and inserting, which serializes concurrent
  consumption for the same owner and prevents double-spending without needing a mutable counter.

Both functions are called via the admin client, so RLS bypass is intentional there too. Role-based
checks in `billing.actions.ts` (`requireBillingPermission`, reusing `can(role,
"organization.billing.manage")` from the Organizations module) exist for clear error messages and
are not the security boundary in organization mode — the select-only RLS policies and the
admin-client-only write path are what actually prevent one organization's members from touching
another's billing data.

## Notifications

`notifications` has select-own and update-own RLS policies but **no insert policy** — a user can
read and mark-read their own notifications directly, but can never insert a row for themselves or
anyone else. Creation only happens through `createNotification()` via the admin client, so an
attacker cannot fabricate notifications (e.g. phishing-style "your password was reset, click
here") by calling the table directly; only trusted server code decides what a user sees in their
inbox.

## Avatar upload

The boilerplate's generic Files module (a `files` table + private `files` bucket) was removed
entirely — see `supabase/migrations/20260913120000_drop_files_and_projects.sql` and
[MODULES.md](MODULES.md). The one thing it did that's still needed, profile avatar upload, lives
in `src/modules/profile/avatar.service.ts` and keeps the same guarantees: all Storage writes go
through the service-role admin client (`src/lib/supabase/admin.ts`), never a user-scoped client,
and content is never trusted at face value — `src/lib/files/validate.ts`'s
`validateFileAgainstConfig()` sniffs the actual file type from its magic bytes and rejects a
mismatch against the declared MIME type, in addition to enforcing `src/config/avatar.ts`'s size
cap and MIME allowlist. The `avatars` bucket is deliberately **public** (profile pictures aren't
sensitive and are meant to be displayed inline without a signed-URL round trip on every page
load).

## Documents (Paperless integration) — Documenti

Three separate defenses apply before a tenant's uploaded file ever reaches Paperless, each
independent of the others:

- **MIME re-sniff**, same "never trust filename extensions or a client-declared type" rule as
  [Avatar upload](#avatar-upload) above, generalized in `src/lib/files/validate.ts`'s
  `validateFileAgainstConfig()` to cover TIFF and zip-based OOXML/ODT formats in addition to the
  original PNG/JPEG/GIF/WEBP/PDF signature set (`documentsConfig.allowedMimeTypes`,
  `src/config/documents.ts`).
- **A real antivirus scan** (`worker/jobs/validate-upload.ts`, `src/lib/files/scan.ts`) — a
  hand-rolled ClamAV `INSTREAM` client, not a dependency (see
  [ADR-0012](adr/0012-clamav-scan-service.md) for why hand-rolled). An unreachable/erroring
  scanner is treated as a retryable infra failure (`ScanUnavailableError`, 502), never as "scan
  skipped, let it through" — the file is never handed to Paperless without a scan actually
  completing.
- **Direct-to-storage isolation**: like `document-uploads`' own bucket design (see
  [DATABASE.md](DATABASE.md#storage-buckets)), there is no `storage.objects` RLS grant for
  `authenticated` at all — knowing another tenant's object key is not sufficient to read it,
  verified live in `e2e/isolation.spec.ts`'s test #18 (a real `authenticated`-role client denied
  downloading by a guessed path, not the admin client).

**Tenant isolation on the Paperless side** is enforced per-object, not per-endpoint, because
Paperless is a single shared instance across tenants (D2). Every object `PaperlessClient`
creates or grants access to must carry the requesting tenant's own owner/group, checked by
`assertOwnership()` (`src/lib/paperless/client.ts`) before the request is even sent — passing a
mismatched owner/group throws immediately rather than silently creating a cross-tenant-visible
object. This is what `createOwnedObject()` (JSON-bodied creates) and
`setOwnedObjectPermissions()` (the permissions PATCH `submit-upload-to-paperless.ts` runs after
`post_document/`, since that endpoint doesn't grant tenant-group access itself — a real,
live-confirmed finding, not a hypothetical) both go through; there is no code path that creates
or grants a Paperless object without this check. `e2e/isolation.spec.ts` (ported from the Phase
0 spike, `scripts/spike/isolation.ts`) verifies this and 9 other cross-tenant checks against a
real two-tenant Paperless+Supabase setup, including one confirmed, still-open Paperless-side leak
(custom field definitions, test #6 — tracked with `test.fail()` so it flags loudly if upstream
ever fixes it, rather than either failing CI forever or silently passing).

**The Paperless post-consume webhook**
(`src/app/api/internal/paperless/document-consumed/route.ts`) is HMAC-SHA256-verified over
`body+timestamp` (`src/lib/paperless/webhook-signature.ts`), matching `infra/scripts/
notify-documenti.sh` exactly — a timing-safe comparison, plus a 5-minute maximum clock skew that
doubles as replay protection (a captured, correctly-signed request replayed after that window is
rejected). Deduplication reuses the existing `webhook_events` table (see
[Billing](#billing) above for the same mechanism's other user), keyed by the signature itself
as the event id, since the webhook's payload carries no event id of its own.

## Document visibility and sharing

Documents are **not** org-wide readable. `documents_select_member` limits reads to the creator, the
organization owner and share recipients, and `document_uploads` follows the same rule
([ADR-0017](adr/0017-per-document-visibility-and-sharing.md)). Paperless cannot enforce this (one
service user per tenant), so the RLS policy is the single enforcement point. Rules for anyone touching
document code:

- Resolve every document read/write/bulk path through the RLS-scoped client before using the admin
  client for the privileged Paperless call. Worker jobs that receive ids must not widen access.
- Shares are written only by `share_document()`/`unshare_document()` (audit in the same
  transaction). `document_shares` has no write policies. Read-only members never gain edit via a share.
- `created_by` is protected by `preserve_document_creator()`; a re-sync must never null or reassign it.
- Cross-tenant and not-visible resources return 404, never 403.
- Entities, connections, tags, correspondents, document types, custom fields, rules and views are
  intentionally org-shared. Confirm new features do not leak document titles through them.

## Deployment security posture

Known gaps to close before production are tracked in [RELEASE_PLAN.md](RELEASE_PLAN.md) §3
(HTTPS in nginx, CSP/security headers, audit-log purge scheduling). Network rules that must hold in
production: only nginx binds public ports; Paperless (`:8010`) and `redis-app`/`clamav` bind
localhost or the Docker network only; `/api/internal/*` is denied by nginx and only reachable inside
the Docker network. Secrets live only in `infra/.env` on the host, never in the repo or image;
`NEXT_PUBLIC_*` values are public by definition and are baked into the client bundle at build time.

## Admin

Application-admin status (`profiles.is_app_admin`) is a plain boolean, checked directly by
`requireAdmin()` — it is never derived from organization role or any other signal (temp.md §44),
so an organization owner/admin gets zero application-admin privileges by default. There is
deliberately no self-service path to becoming the first admin (no UI, no signup flag) — the only
way is a direct database update, which requires infrastructure-level access already.

Every admin-issued mutation writes through the service-role admin client, exactly like billing
and notifications — `profiles`, `organizations`, and `subscriptions` have no RLS policy that lets
one user modify another's row (or, for `organizations`, lets a non-owner delete it), so these
mutations are only reachable through trusted server code, gated by `requireAdmin()` +
`requireFeature("admin")` in `src/app/(admin)/layout.tsx`.

**Self-lockout guards**: `src/modules/admin/users.service.ts` throws if an admin tries to
suspend, revoke their own admin status from, or delete their own account. There's no recovery
flow if the only admin locks themselves out, so this is a hard guard in code, not a documented
warning.

**Organization suspension is an RLS-level block, not an application-side check.** A suspended
organization's `suspended_at` is read by `is_organization_member()` and `has_organization_role()`
— the two SECURITY DEFINER helpers essentially every org-scoped RLS policy is built on
(`organizations`, `organization_members`, `organization_invitations`, `stripe_customers`,
`subscriptions`, `credit_transactions`, `usage_counters`, `audit_logs`). The moment an
org is suspended, every one of those policies stops granting access to its non-admin members —
there is no per-route guard to remember, and no way to bypass it short of going through
`is_app_admin()` (which every policy also allows, so admins can still un-suspend it).

**Deletion relies on the schema's existing `on delete cascade` foreign keys**, not hand-rolled
multi-table cleanup: `deleteUserAdmin`/`deleteOrganizationAdmin` each perform exactly one root-row
delete (`auth.users` via the Supabase Admin Auth API, or `organizations` directly) and let
Postgres cascade the rest. `audit_logs.organization_id` is the one FK that's `on delete set null`
rather than cascade, so the audit trail for a deleted organization survives with that column
nulled out. Because of that FK, every deletion path logs the event **before** deleting the row —
logging after would fail to insert (silently, since `logEvent()` never throws) once the
referenced organization no longer exists. The one non-trivial deletion rule: deleting a user who
is the **sole owner** of an organization deletes that organization first, so it's never left
ownerless.

**The subscription platform override is a pure entitlement gate, not a Stripe action** — toggling
`subscriptions.platform_disabled_at` never calls the Stripe API and never touches
`cancel_at_period_end`. It only changes what `getOwnerPlan()` returns in-app.

## Audit Logs

`logEvent()` (`src/lib/events/index.ts`) is the usual way an `audit_logs` row is created — the
table has select-only RLS (`is_app_admin()`, or an org owner/admin for their own org's rows) and
no insert policy at all, so a client can never fabricate an audit entry; only the admin client,
via `auditLogSink`, can write one. A sink failure (including the audit-log insert itself) is
caught inside `logEvent()` and logged, never thrown back into the caller — an audit-logging
hiccup can never turn an otherwise-successful action into an error response. That
never-throws-back guarantee is exactly why it's the *wrong* mechanism for one category of
mutation — see below.

**Organization permission changes are the one exception to `logEvent()`.** `update_member_role`,
`remove_member`, `leave_organization`, and `transfer_organization_ownership` (Documenti,
ADR-0008) write their audit row *inside the same Postgres transaction* as the mutation itself,
as a SECURITY DEFINER function, rather than via a plain RLS-scoped mutation plus a separate
`logEvent()` call from the action layer. The reason is the guarantee described in the paragraph
above: `logEvent()`'s sinks are deliberately best-effort and never throw, which is correct for
supplementary logging but wrong for a mutation the spec treats as requiring a guaranteed audit
record. If the `auditLogSink` insert failed after a role change already succeeded, the caller
would see success with a silent gap in the audit trail — acceptable for most actions, not for a
permission change. These four functions also each replicate `has_organization_role()`'s
owner/admin check explicitly in the function body (SECURITY DEFINER bypasses RLS, so the check
has to happen there instead) rather than relying on the caller having already passed an RLS
policy.

`audit_logs` rows are retained for **2 years** (extended from the original 30-day admin-only
window, ADR-0005, once this table started also carrying Documenti's business audit —
`supabase/migrations/20260827000000_audit_log_retention.sql`). `purge_old_audit_logs()` (added in
`20260823090000_admin.sql`) deletes anything older than that, but **no scheduler invokes it
yet** — this is a deliberate, known gap: wiring up `pg_cron` (or an external scheduler hitting an
admin-only route) is follow-up work, not silently forgotten.
