# Implementation Plan

This repository is implemented incrementally, with one branch per major module and small
conventional commits inside each branch.

## Branch Sequence

1. `feat/foundation`: application scaffold, configuration, env validation, Supabase clients,
   initial schema/RLS, shared UI, and docs.
2. `feat/auth`: registration, login, logout, verification, password recovery, OAuth, MFA,
   onboarding, account settings, route protection, and profile management.
3. `feat/organizations`: organizations, members, roles, permissions, invitations, workspace
   switching, and cross-tenant tests.
4. `feat/email`: Resend provider abstraction, React Email templates, and safe development email
   mode.
5. `feat/billing`: Stripe customers, Checkout, Customer Portal, subscriptions, webhooks,
   entitlements, usage limits, credits, and credit purchases.
6. `feat/notifications`: in-app notifications, notification preferences, counts, pagination, and
   service APIs.
7. `feat/files`: Supabase Storage workflows, avatar upload, file metadata, ownership, MIME/size
   validation, signed URLs, and cleanup hooks.
8. `feat/admin`: admin dashboard, audit log service, user administration, application admin roles,
   and privileged mutation audit coverage.
9. `docs/finalize`: final documentation, diagrams, setup checklist, audit fixes, and final
   verification.

Use standardized slash-style branch names for all new increments.

## Defaults

- Package manager: npm.
- Billing owner: user by default, organization billing supported by configuration.
- AI, analytics, and API key modules are intentionally out of scope for this implementation pass.
- Supabase RLS is the primary data authorization boundary.
- Stripe is the source of truth for subscriptions and payment state.

## Foundation Acceptance Criteria

- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` pass.
- App scaffold has a working landing shell, dashboard shell, pricing shell, auth placeholder routes,
  and health endpoint.
- Shared configuration and env validation are typed and tested.
- Supabase clients follow SSR cookie patterns and never expose service-role credentials to browser
  code.
- Initial migrations define shared tables, indexes, triggers, and RLS policies for later modules.

## Auth Acceptance Criteria

- Auth pages render in a fresh clone before Supabase is configured.
- Supabase credentials are required only when auth mutations or authenticated session reads need
  real provider access.
- Registration, login, logout, password reset, verification resend, OAuth callback, profile update,
  password change, onboarding, and MFA actions are implemented.
- Protected dashboard/settings routes redirect guests to login.
- Safe redirects reject external and protocol-relative destinations.

## Organizations Acceptance Criteria

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` pass.
- Create, rename, and delete organization; invite, resend, revoke, and accept invitations; update
  member roles, remove members, leave, and transfer ownership are all implemented.
- Cross-tenant access is enforced by RLS (and by SECURITY DEFINER functions for the operations RLS
  alone cannot express — see `docs/SECURITY.md`), not solely by application-layer checks.
- A member cannot leave as an organization's sole remaining owner.
- Organization-scoped pages redirect guests to login and require the `organizations` feature flag.
- Invitations do not depend on the (not-yet-implemented) email module — the invite link is surfaced
  directly in the UI for the admin to send manually until `feat/email` lands.

## Email Acceptance Criteria

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` pass.
- A pluggable `EmailProvider` abstraction exists with two working implementations (`console`,
  `smtp`) selected via `EMAIL_PROVIDER`; adding another provider never requires touching
  `email.service.ts` or any caller.
- `EMAIL_PROVIDER=console` (the default) requires no credentials and never sends real email, so a
  fresh clone works without SMTP configured.
- `EMAIL_DEV_RECIPIENT` reroutes every outgoing email to one inbox regardless of the real
  recipient, independent of which provider is active.
- Organization invitations send a real email (via the shared branded layout) when SMTP is
  configured, and degrade gracefully — the invite record and copyable link still work — when it
  isn't or when delivery fails.
- Templates are strongly typed per `sendEmail({ to, template, variables })` call; SMTP credentials
  are server-only and never logged.

## Billing Acceptance Criteria

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` pass.
- Billing ownership (user vs. organization) is derived from `features.organizations`, never an
  independently configurable setting — `resolveBillingOwner()` is the single place this is decided,
  and every billing/usage/credit function takes the resolved owner rather than branching on the
  feature flag itself.
- Checkout, the Customer Portal, subscription webhooks (idempotent, signature-verified), plan
  entitlements, usage limits, the credit ledger, and one-time credit-pack purchases are all
  implemented.
- Stripe — via the webhook handler — is the source of truth for subscription state, never the
  Checkout success redirect.
- Usage-limit increments and credit consumption are safe under concurrency (atomic SQL functions,
  not read-then-write from application code).
- All billing table writes go through the service-role admin client, matching the tables'
  select-only RLS policies; in organization mode, only owner/admin members can manage billing
  (`can(role, "organization.billing.manage")`), reusing the Organizations module's RBAC rather than
  a new permission system.
- `/settings/billing` and `/pricing` both work correctly whether `features.organizations` is on or
  off, with no separate code paths for the two modes.
