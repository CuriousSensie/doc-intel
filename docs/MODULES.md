# Modules

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
| Notifications | Optional | Auth |
| Admin | Optional | Auth |
| Audit Logs | Recommended | Admin |
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
`supabase/migrations/20260820120000_organizations_functions.sql`. See `docs/SECURITY.md` for why
these operations need SECURITY DEFINER functions instead of plain RLS-scoped queries.

**Configuration**: gated by `features.organizations` in `src/config/features.ts`. Roles are
`owner`, `admin`, `member` (the `organization_role` enum); role permissions are defined in
`src/modules/auth/authorization.ts`'s `can()` helper.

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
