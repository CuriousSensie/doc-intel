# Modules

This is the narrative doc — what each module does, when to enable/disable it, and how to extend
it. For exact function signatures, see [API_REFERENCE.md](API_REFERENCE.md); for the schema
those functions read/write, see [DATABASE.md](DATABASE.md).

| Module | Default | Dependency |
| --- | ---: | --- |
| Authentication | Required | Supabase |
| Profiles | Required | Auth |
| Email | Required | SMTP |
| Organizations | Optional | Auth |
| RBAC | Optional | Organizations |
| Billing | Optional | Stripe |
| Credits | Optional | Billing |
| Files | Optional | Supabase Storage |
| Documents | Optional | Organizations, Supabase Storage, Paperless — Pomočnik |
| Notifications | Optional | Auth |
| Admin | Optional | Auth |
| Audit Logs | Recommended | Auth (the write side, `src/lib/events/`, has no dependency on Admin — only the `/admin/audit-log` read UI does) |
| Outgoing Webhooks | Optional | Organizations |

Analytics and API keys are intentionally skipped in this implementation pass.

## Authentication

The auth module uses Supabase Auth with SSR cookies. It provides registration, login, logout,
verification resend, password reset, OAuth callback handling, profile onboarding, account security
settings, and optional TOTP MFA.

## Organizations

**Purpose**: optional multi-tenancy — a user can belong to multiple organizations, each with its
own members, roles, and pending invitations.

**Dependency**: Auth. Uses the `organizations`, `organization_members`, and
`organization_invitations` tables defined in the initial schema migration, plus the
`create_organization`, `get_organization_invitation`, `accept_organization_invitation`, and
`transfer_organization_ownership` SECURITY DEFINER functions from
`supabase/migrations/20260820120000_organizations_functions.sql`, and (Pomočnik,
`20260912195634_transactional_membership_audit.sql`) `update_member_role`, `remove_member`, and
`leave_organization` — these three used to be plain RLS-scoped mutations from
`organizations.actions.ts`; they became SECURITY DEFINER functions specifically so their audit
row writes transactionally with the mutation (ADR-0008), not because RLS was ever the blocker.
See `docs/SECURITY.md` for why each category needs what it needs.

**Configuration**: gated by `features.organizations` in `src/config/features.ts`. Roles are
`owner`, `admin`, `member`, `read-only` (the `organization_role` enum — the 4th role added for
Pomočnik, `supabase/migrations/20260824000000_pomocnik_orgs_extension.sql`); role permissions
are defined in `src/modules/auth/authorization.ts`'s `can()` helper. `read-only` has the same
read access as `member` but no write access anywhere — enforced at the RLS layer by
`has_organization_write_access()`, not just by `can()`, since RLS is the real boundary
(`docs/SECURITY.md`).

**How to enable**: set `FEATURE_ORGANIZATIONS=true` (default). The "Organizations" and "Team" nav
entries in `src/config/navigation.ts` and the `/settings/team` tab appear automatically once
enabled.

**How to disable**: set the feature flag to `false`. Pages under
`src/app/(dashboard)/organizations/` and `src/app/(dashboard)/settings/team/` call
`requireFeature("organizations")`, which throws if the flag is off, and the nav entries disappear.

**How to extend**: `src/modules/organizations/organizations.service.ts` holds all data access;
`organizations.actions.ts` holds the server actions. The active organization for a session is
tracked via an `active_org` cookie (`src/modules/organizations/active-organization.ts`), not a URL
param, so other modules (billing, files) can read `getActiveOrganizationId()` without threading an
org id through every route.

**Note**: inviting a member creates the invitation record, sends the invitation email (see the
Email module below), and still surfaces the one-time invite link in the UI so an admin has a
fallback if delivery fails or SMTP isn't configured yet.

## Email

**Purpose**: required transactional email — currently just organization invitations; more
templates get added alongside the module that triggers them (billing receipts, security alerts,
etc.), not ahead of time.

**Dependency**: none required to enable (the module is always on) — an SMTP mailbox is only needed
if you want real delivery. Without one, `EMAIL_PROVIDER=console` logs rendered emails instead of
sending them, so the app works out of the box in a fresh clone. See `docs/SETUP.md` for setup
steps.

**Configuration**: `EMAIL_PROVIDER` (`console` or `smtp`), `EMAIL_FROM`, `EMAIL_DEV_RECIPIENT`, and
`SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASSWORD` in `.env.local` (schema in
`src/lib/env.ts`).

**How to enable**: nothing to enable — it's required infrastructure, like Auth. Set
`EMAIL_PROVIDER=smtp` plus the `SMTP_*` variables to send real email instead of logging it.

**How to extend**:

- Add a template: create a React Email component in `src/emails/` (wrap it in the shared
  `EmailLayout` from `src/emails/layout.tsx` for consistent branding), then add an entry to the
  `templates` registry in `src/modules/email/email.service.ts` with a `subject` function and the
  variables type. `sendEmail({ to, template, variables })` is fully typed per template key.
- Add a provider: implement the `EmailProvider` interface (`src/lib/email/types.ts` —
  one `send(message)` method) in a new file under `src/lib/email/`, then add a case for it in
  `getEmailProvider()`'s switch statement in `src/lib/email/index.ts` and a new `EMAIL_PROVIDER`
  enum value in `src/lib/env.ts`. `ConsoleEmailProvider` and `SmtpEmailProvider` are the two
  reference implementations — switching providers never touches `email.service.ts` or any caller.
- `sendEmail()` never throws — a delivery failure is logged and returns `null` so callers (like
  the organization invitation flow) can degrade gracefully instead of blocking the action that
  triggered the email.

## Billing

**Purpose**: Stripe subscriptions, Checkout, the Customer Portal, plan entitlements, and usage
limits.

**Dependency**: Stripe. Uses the `stripe_customers`, `subscriptions`, and `usage_counters` tables
and the `increment_usage_counter` SECURITY DEFINER function from the initial schema and
`supabase/migrations/20260821130000_billing_functions.sql`. All writes to these tables go through
the service-role admin client (`src/lib/supabase/admin.ts`), not user-scoped RLS — see
`docs/SECURITY.md`.

**Configuration**: gated by `features.billing`. Plans, prices, and feature limits are defined in
`src/config/billing.ts`; Stripe price ids come from `STRIPE_PRICE_*` env vars (`src/lib/env.ts`).
**Who billing applies to is not independently configurable** — `billingOwnerType` in
`src/config/billing.ts` is derived from `features.organizations`: organizations enabled means the
active organization is billed and individual members never pay; disabled means every user is
billed directly. See `src/modules/billing/owner.ts`'s `resolveBillingOwner()`, which is the single
place this decision is made — every other billing/usage/credit function takes the resolved
`BillingOwner` and never branches on the feature flag itself, so one `/settings/billing` page and
one service layer serve both modes without duplicated code paths.

**How to enable**: set `FEATURE_BILLING=true` (default) plus `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET`. See `docs/SETUP.md` for creating products/prices and configuring the
webhook endpoint (`/api/webhooks/stripe`).

**How to extend**: `src/modules/billing/billing.service.ts` holds Stripe customer resolution, plan
resolution, and Checkout/Portal session creation; `usage.service.ts` holds usage-limit
tracking; `billing.actions.ts` holds the server actions (gated by
`can(role, "organization.billing.manage")` in org-mode, reusing the RBAC from the Organizations
module — only owner/admin can manage billing, never a plain member). The webhook handler
(`src/app/api/webhooks/stripe/route.ts`) is the source of truth for subscription state — never
trust the Checkout success redirect alone.

## Credits

**Purpose**: a prepaid-usage ledger for products that sell credit packs or grant monthly credits
alongside a subscription.

**Dependency**: Billing. Uses the `credit_transactions` table (a pure ledger — never a mutable
balance column, so the balance is always derivable and auditable) and the `consume_credits`
SECURITY DEFINER function, which serializes concurrent consumption per owner via a Postgres
advisory lock to prevent double-spending.

**Configuration**: gated by `features.credits`. Credit packs (name, credit amount, price, Stripe
price id) are defined in `billingConfig.creditPacks` (`src/config/billing.ts`); each paid plan's
`features.credits` is granted automatically on every successful invoice via the Stripe webhook.

**How to enable**: set `FEATURE_CREDITS=true` (default) and configure `STRIPE_PRICE_CREDITS_*` env
vars for each pack you want purchasable.

**How to extend**: `src/modules/billing/credits.service.ts` exports `getCreditBalance`,
`grantCredits`, `consumeCredits`, `refundCredits`, and `adminAdjustCredits`. Only `consumeCredits`
needs the atomic SQL function — granting credits is always a safe plain insert since there's no
double-spend risk when adding to the ledger, only when subtracting from it.

## Notifications

**Purpose**: in-app notifications — read/unread state, mark-one/mark-all-read, unread count,
cursor-based pagination.

**Dependency**: Auth. Uses the `notifications` table from the initial schema (select-own/update-own
RLS only — no insert policy, since creation only ever happens through the service).

**Configuration**: gated by `features.notifications`. `src/modules/notifications/notifications.service.ts`'s
`createNotification` silently no-ops when the flag is off, so producers never need to check the
flag themselves before calling it.

**How to enable**: set `FEATURE_NOTIFICATIONS=true` (default). `/dashboard/notifications` is the
inbox; `/settings/notifications` is a one-line redirect to it (there's no separate
preferences page — nothing today needs one, so it wasn't built ahead of a real requirement).

**How to extend**: call `createNotification(userId, { type, title, message, metadata })` from
wherever a real event happens — see `notifyOrganizationAdminsOfNewMember` in
`src/modules/organizations/organizations.actions.ts` for the reference pattern: a small
per-event helper that resolves recipients and fires both the notification and (if relevant) an
email, wrapped in its own try/catch so a notification failure never turns an already-successful
action into an error response. `src/lib/pagination.ts`'s `encodeCursor`/`decodeCursor` are
written generically enough for other paginated lists (files, audit logs) to reuse rather than
each inventing its own cursor scheme.

If several features end up needing the same "notify these people via email and in-app" shape,
consider centralizing into a small event-dispatch module (`event type -> channels`) at that
point — not before, per temp.md §109's guidance against abstraction layers with only one real
caller.

## Files

**Purpose**: Supabase Storage-backed file uploads with ownership, ownership-based access, MIME/size
validation, and signed downloads — a generic `/dashboard/files` list plus the concrete avatar
upload workflow on `/settings/profile`.

**Dependency**: Supabase Storage. Uses the `files` table from the initial schema (select-own/select-org-member/select-admin,
insert-owner, delete-owner-or-org-admin RLS — no update policy) plus the `avatars` (public) and
`files` (private) Storage buckets created in
`supabase/migrations/20260822090000_files_storage.sql`.

**Configuration**: gated by `features.files`. Per-category size caps and MIME allowlists
(`avatar`, `document`) live in `src/config/files.ts`, along with the signed-URL expiry used for
private downloads.

**How to enable**: set `FEATURE_FILES=true` (default). `/dashboard/files` and the avatar section
on `/settings/profile` appear automatically once enabled.

**How to extend**: `src/modules/files/files.service.ts` holds all Storage/DB access —
`uploadFile`/`uploadAvatar` (validate via `src/lib/files/validate.ts`'s magic-byte sniffing, then
write through the admin client), `listFiles` (cursor-paginated, reusing `src/lib/pagination.ts`
through the user-scoped client so RLS does the visibility filtering), `deleteFile` (an
app-level ownership/org-admin check via `canManageFile` before an atomic storage-object + row
delete through the admin client), and `getFileDownloadUrl` (confirms visibility via the
user-scoped client, then mints a signed URL through the admin client — see
`src/app/api/files/[id]/download/route.ts`). Uploads are automatically scoped to the uploader's
active organization when organizations are enabled (no per-upload "share with org" toggle exists
yet — add one only once a real need for private-within-org files shows up). Deleting an
org-scoped file as an org admin (not just the file's owner) reuses `can(role, "organization.files.manage")`
from the Organizations module's RBAC, the same pattern as billing's permission checks.

## Documents — Pomočnik

**Purpose**: tenant document upload → Paperless ingestion → a queryable local mirror
(`documents`), with a real UI to exercise it (`/dashboard/documents`) rather than only API
routes. Paperless owns the file and its OCR text; this module never re-implements OCR or
full-text search — see `specs/00-overview.md`'s locked decisions (D1) for why.

**Dependency**: Organizations (every document belongs to an org), Supabase Storage
(direct-to-storage upload, `document-uploads` bucket), Paperless (the actual document engine,
reached via `src/lib/paperless/client.ts`'s `paperlessFor(orgId)`), and a running `worker`
process — uploads do nothing without one.

**Configuration**: gated by `features.documents`. Size cap and MIME allowlist in
`src/config/documents.ts` (separate from the generic Files module's `src/config/files.ts` — a
100MB cap and PDF/image/office-doc allowlist, not the generic module's smaller/simpler one).

**How to enable**: set `FEATURE_DOCUMENTS=true` (default). The "Documents" nav entry
(`src/config/navigation.ts`) and `/dashboard/documents` appear automatically once enabled.

**The pipeline** (`specs/01-architecture.md` §Upload), each stage a separate BullMQ job so a
crash partway through resumes rather than restarting from scratch:

1. `createUploadIntent()`/`completeUpload()` (`documents.service.ts`) — the browser PUTs the
   file directly to Storage using a signed URL; our server never buffers the bytes. Enqueues
   `validate-upload`.
2. `worker/jobs/validate-upload.ts` — MIME re-sniff + a real ClamAV scan
   (`src/lib/files/scan.ts`, see `docs/SECURITY.md#documents-paperless-integration--pomočnik`
   for why this exists and how it's implemented). Claimed via a single atomic RPC
   (`claim_upload_validation()`), which also accepts re-claiming its own prior attempt after a
   retry — see `docs/DATABASE.md`'s Functions table for why that matters.
3. `worker/jobs/submit-upload-to-paperless.ts` — POSTs to Paperless as the tenant's own service
   user, persists the returned task id *immediately* (the checkpoint a retry resumes from,
   since re-POSTing would create a duplicate document), polls until consumption finishes, then
   PATCHes tenant-group permissions onto the result (`post_document/` doesn't grant these
   itself — confirmed live, not assumed).
4. `worker/jobs/sync-paperless-document.ts` — the one place that ever writes the `documents`
   mirror row, upserting rather than claiming (multiple callers can legitimately race here — see
   below). Also the first-ever writer of a `paperless_object_map` row with `object_type='document'`,
   done defensively (a conflict is only trusted as "already ours" after confirming the org
   matches). Fires the `document.ingested` rule trigger (the rule engine itself isn't built —
   this only enqueues the trigger) and notifies the uploader.

**Three independent paths call `sync-paperless-document.ts`** with the same
`{orgId, paperlessDocumentId, uploadId?}` shape: the upload pipeline above (`uploadId` set), the
Paperless post-consume webhook (`/api/internal/paperless/document-consumed`, HMAC-verified —
`docs/SECURITY.md`), and the reconciliation sweep below (no `uploadId`). This is why it's
idempotent-by-upsert rather than claim-based like the first two jobs.

**Reconciliation** (`worker/jobs/reconcile-incremental.ts`, every 5 min;
`worker/jobs/reconcile-full-sweep.ts`, daily) is the backstop for the webhook's best-effort
delivery — "the post-consume script is the source of *latency*, reconciliation is the source of
*correctness*" (`specs/01-architecture.md`). Incremental queries Paperless for documents
added/modified since the tenant's `last_reconciled_at` and re-syncs them; full sweep additionally
lists *every* document a tenant has and flags anything mirrored-but-gone as `orphaned` — the only
one of the two that can detect a Paperless-side deletion, since incremental only ever sees a
filtered window, never the full set. Both are the first jobs in this codebase registered as an
actual recurring schedule (BullMQ v6 `Queue.upsertJobScheduler()`, `worker/index.ts`) rather than
enqueued on demand — the same pattern `worker/jobs/expire-abandoned-uploads.ts` (a global,
non-tenant-scoped sweep for stuck `document_uploads` rows) already established.

**How to extend**: `documents.service.ts`'s `listDocuments()`/`listRecentUploads()` back the
current UI — deliberately unfiltered/unpaginated-by-filter (recency-ordered, capped at 50); the
full mixed-filter `listDocuments()` (`type`/`date`/`entity`/`status`/full-text `q` passthrough to
Paperless) is Phase 2 scope, not built yet. `listRecentUploads()` exists specifically to surface
`document_uploads` rows with no `documents` row yet — without it, an upload is invisible in the
UI for the entire window between "upload-complete returned" and "sync-paperless-document.ts
finishes."

## Admin

**Purpose**: an application-admin dashboard — user administration (search, suspend/unsuspend,
grant/revoke admin, delete), organization administration (suspend/unsuspend, delete), and a
platform-level subscription enable/disable override, all gated behind application-admin status.

**Dependency**: Auth. Application-admin status is `profiles.is_app_admin`, a plain boolean —
**never inferred from organization role** (temp.md §44). `requireAdmin()`/`requireFeature("admin")`
(both pre-existing) are enforced once, for the whole section, in `src/app/(admin)/layout.tsx`
rather than repeated on every admin page.

**Configuration**: gated by `features.admin`.

**How to enable**: set `FEATURE_ADMIN=true` (default), then flip a user's `profiles.is_app_admin`
to `true` directly in the database (there's no self-service way to become the first admin, by
design — see `docs/SECURITY.md`).

**How to extend**: `src/modules/admin/users.service.ts` and `src/modules/admin/organizations.service.ts`
hold the privileged mutations; `src/modules/admin/billing.service.ts` holds the subscription
platform-override; `src/modules/admin/admin.actions.ts` wraps each in a server action. Every
mutation here goes through the admin client and calls `logEvent()` — see **Audit Logs** below.

Two behaviors worth knowing before extending this module:

- **Organization suspension is enforced at the RLS level**, not by an application-side guard you
  could forget to add. `is_organization_member`/`has_organization_role` (the two SECURITY DEFINER
  helpers nearly every org-scoped RLS policy is built on) now also require the organization isn't
  suspended, so suspending one instantly cuts off every non-admin member's access to that org and
  everything scoped to it (members, invitations, billing, files) without touching a single route.
- **Self-lockout guards** (`users.service.ts`) block an admin from suspending, de-adminning, or
  deleting their own account — there's no recovery path if the only admin locks themselves out,
  so this is enforced in code rather than left as an operational risk.
- **Deletion relies on existing FK cascades**, not hand-rolled cleanup — `deleteUserAdmin` and
  `deleteOrganizationAdmin` each do one root-row delete and let the schema's `on delete cascade`
  foreign keys remove everything else. The one hand-written edge case: deleting a user who is the
  **sole owner** of an organization deletes that organization first, so it's never left ownerless.
- **The subscription platform override never calls Stripe.** `setSubscriptionPlatformStatus`
  toggles `subscriptions.platform_disabled_at`, and `getOwnerPlan()`
  (`src/modules/billing/billing.service.ts`) filters it out — a disabled owner reads as the
  `"free"` plan in-app while their real Stripe subscription and `cancel_at_period_end` are
  untouched. It's a pure entitlement gate, not a cancellation.

Credit adjustment (reusing the existing `adminAdjustCredits`) and the subscription override both
target a `BillingOwner`, so they only appear on `/admin/users` in user-billing mode or
`/admin/organizations` in organization-billing mode — never both, no mode-specific branching
beyond that one condition, the same convention `/settings/billing` already follows.

## Audit Logs

**Purpose**: a generic, pluggable event-logging dispatcher — not admin-only. `logEvent()`
(`src/lib/events/index.ts`) fans an event out to every configured `EventSink`; today that's
`consoleSink` (via `src/lib/logger.ts`) and `auditLogSink` (writes to the `audit_logs` table).
**To add a new destination** (Slack, analytics, anything else), write one more `EventSink` object
and push it into the `sinks` array in `src/lib/events/index.ts` — no existing call site changes.
A sink's failure is caught and logged, never blocking another sink or the caller (same
never-throw convention as `sendEmail()`).

**Dependency**: Admin, for the read side (`/admin/audit-log`). The write side
(`src/lib/events/`) has no dependency on the admin module at all, precisely so any module can
call `logEvent()` without creating one.

**Configuration**: not feature-flagged — `logEvent()` always runs; whether an event is worth
logging is a call-site decision, not a config toggle. `audit_logs` rows are retained for 2 years;
see `docs/SECURITY.md` for the retention mechanism.

**How to extend**: call `logEvent({ actorId, action, entityType?, entityId?, organizationId?,
metadata? })` from any real mutation worth an audit trail — action names are dot-namespaced
(`auth.login`, `organization.member.removed`, `admin.user.suspended`, `billing.subscription.updated`,
`file.deleted`, etc.). Current callers: every admin-issued mutation in this module, plus the most
security/state-changing existing flows in auth (`auth.actions.ts`), organizations
(`organizations.actions.ts` — for everything *except* the four permission-change actions below),
the Stripe webhook handler (actor is `null` for these — system/Stripe-initiated), and files
(`files.service.ts`). Read-only
actions (listing, viewing) are intentionally not logged. **Organization permission changes are
the one exception**: `update_member_role`/`remove_member`/`leave_organization`/
`transfer_organization_ownership` in `organizations.actions.ts` no longer call `logEvent()` at
all — they write their audit row transactionally inside the Postgres function itself instead
(ADR-0008, `docs/SECURITY.md#audit-logs`), precisely because `logEvent()`'s never-throws
guarantee is the wrong shape for a mutation that needs a *guaranteed* audit record. If an event's
`organization_id` references an organization about to be deleted in the same action, log it
**before** the delete — `audit_logs.organization_id` is a real foreign key, and inserting after
the org is gone would fail (see `deleteOrganizationAdmin` in
`src/modules/admin/organizations.service.ts` for the reference ordering).

**Reading it back**: `listAuditLogs()` (`src/modules/admin/audit-log.service.ts`) is the
app-admin global feed behind `/admin/audit-log`. `listAuditLogsForSubject(entityType, entityId)`
— Pomočnik — is the same cursor-paginated shape scoped to one entity's history instead (a
document, an `organization_member`); it adds no authorization of its own, relying entirely on
the same select RLS as the global feed.
