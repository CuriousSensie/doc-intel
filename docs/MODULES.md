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
