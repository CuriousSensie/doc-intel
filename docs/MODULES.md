# Modules

| Module | Default | Dependency |
| --- | ---: | --- |
| Authentication | Required | Supabase |
| Profiles | Required | Auth |
| Email | Required | Resend |
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

**Known gap**: inviting a member creates the invitation record and returns a one-time invite link
in the UI for the admin to copy and send manually — there is no email module yet. `feat/email` will
wire `createInvitation`'s existing token to an actual send without changing this module's schema or
service functions.
