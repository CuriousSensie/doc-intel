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

## Notifications Acceptance Criteria

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` pass.
- Notifications can only be created through the service (admin client, no insert RLS policy);
  reading and marking-read use the normal user-scoped client since RLS already permits a user to
  touch their own rows.
- `createNotification` no-ops when `features.notifications` is off rather than requiring every
  caller to check the flag.
- Listing is cursor-paginated (not offset-based), reusing a generic cursor helper rather than a
  notifications-specific one.
- At least one real producer exists (organization invitation acceptance notifies the org's
  owner/admins) — no notification-sending code without a real caller.
- The unread count shown on the dashboard reflects the true total, not just the current page.

## Files Acceptance Criteria

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` pass.
- All Storage writes (upload, delete, signed-URL minting) go through the service-role admin
  client; no `storage.objects` RLS policies exist because nothing accesses Storage directly from
  the browser.
- Uploaded content is validated by magic-byte sniffing, not just the declared MIME type or
  filename extension, and rejected if it exceeds its category's size cap or isn't on its
  allowlist.
- The `files` bucket is private — downloads only happen through a signed URL minted after
  confirming the requesting user can see the row via RLS; the `avatars` bucket is public.
- Listing is cursor-paginated, reusing the same generic cursor helper as Notifications.
- Two real callers exist: the generic `/dashboard/files` list and the avatar upload workflow on
  `/settings/profile` — no speculative third use case.
- Deleting a file is gated by an application-level ownership/org-admin check
  (`can(role, "organization.files.manage")`), reusing the Organizations module's RBAC.
- Replacing an avatar uploads the new object, updates `profiles.avatar_url`, and only then
  deletes the previous object — never leaving the profile pointing at a missing file.

## Admin Acceptance Criteria

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` pass.
- Application-admin status (`profiles.is_app_admin`) is a plain boolean, never inferred from
  organization role; `requireAdmin()` + `requireFeature("admin")` are enforced once, in
  `src/app/(admin)/layout.tsx`, for the whole admin section.
- Every admin-issued mutation (user suspend/unsuspend/delete/admin-grant, organization
  suspend/unsuspend/delete, credit adjustment, subscription platform override) writes through the
  service-role admin client and calls `logEvent()`.
- Self-lockout guards block an admin from suspending, de-adminning, or deleting their own
  account — there is no recovery path if the only admin locks themselves out.
- Organization suspension blocks non-admin members' access to that org's data at the RLS level
  (via `is_organization_member`/`has_organization_role`), not via a per-route application check.
- User and organization deletion rely on the schema's existing FK cascades for cleanup, with one
  explicit exception: deleting a user who solely owns an organization deletes that organization
  first, so it's never left ownerless.
- The subscription platform override never calls Stripe or touches `cancel_at_period_end` — it
  only changes what `getOwnerPlan()` resolves to in-app.
- A generic `logEvent()` dispatcher (`src/lib/events/`) fans events out to a list of `EventSink`s
  (console, `audit_logs`); adding a new destination requires writing one sink and registering it,
  not touching any existing call site. A sink's failure never blocks another sink or the caller.
- Audit coverage extends beyond admin-issued mutations to the existing security/state-changing
  flows in auth, organizations, billing (webhook-driven), and files — read-only actions are not
  logged.
- `audit_logs` creation only ever happens through `logEvent()` (no insert RLS policy); rows are
  retained for 30 days via `purge_old_audit_logs()`, though no scheduler invokes it yet
  (documented, deliberate follow-up).

## docs/finalize Acceptance Criteria

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` pass.
- `README.md` is a real entry point: tech stack, project structure, module table, quick start,
  and links to every doc below — not just install/dev commands.
- `docs/ARCHITECTURE.md` includes a request-flow diagram, an auth flow diagram, and a billing flow
  diagram (Mermaid, embedded in the doc), plus the key architectural decisions and why each one
  was made.
- `docs/DATABASE.md` exists with a full Mermaid ER diagram covering every table, a column
  reference, the enum/function/Storage-bucket lists, and the migration history — the schema is no
  longer only discoverable by reading the migration files directly.
- `docs/API_REFERENCE.md` exists with every exported function/type from `src/modules/**`,
  `src/lib/**`, and `src/config/**` — a dev can look up an exact signature without opening the
  source file.
- `docs/SETUP.md` covers OAuth provider configuration, deployment (not just local dev), and a
  New Product Checklist for starting a real product from this boilerplate — the three gaps temp.md
  explicitly calls out.
- Every script name, environment variable, and migration filename referenced across the docs was
  verified against the actual source (`package.json`, `src/lib/env.ts`,
  `supabase/migrations/`), not recalled from memory or copied from an earlier, possibly-stale doc.
- `docs/MODULES.md` and `docs/SECURITY.md` cross-link to `API_REFERENCE.md`/`DATABASE.md` rather
  than duplicating their content, and any inaccuracy the accuracy pass found (e.g. a stale
  module-dependency table row) is fixed, not just noted.
