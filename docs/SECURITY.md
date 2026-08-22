# Security

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
