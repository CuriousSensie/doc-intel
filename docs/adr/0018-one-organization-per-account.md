# ADR-0018: One organization per account, streamlined invites, member blocking

## Context

1.0.0 shipped with a multi-org membership model: a user could belong to and switch between
several organizations (`organization-switcher.tsx`, `switchOrganizationAction`), an organization
was created via a separate `/organizations/new` step after registration, and an invited employee
went through the generic `/register` flow (full Supabase email verification) before accepting an
invitation. Post-launch feedback said this doesn't match how the actual customer (a single
company account) uses the product: one account maps to exactly one organization, and an
owner/admin adding an employee should not require that employee to self-register and verify an
email the invitation link already proved they control.

## Decision

- **One organization per account.** `organization_members.user_id` gets a unique constraint
  (`organization_members_user_id_key`,
  `20260928000000_one_org_per_account_and_blocking.sql`) enforced at the database, not just the
  application, layer. `create_organization()` and `accept_organization_invitation()` both raise
  an explicit exception if the caller already has any membership row, rather than relying on the
  constraint's raw unique-violation. The org switcher and the `/organizations` list page are
  gone; `/organizations` is now the single team-management page.
- **Registration creates the organization.** `/register` collects an organization name
  alongside the owner's own name; the row is created the moment the owner's session first
  becomes valid (`src/app/auth/callback/route.ts`, right after `exchangeCodeForSession`), not as
  a separate post-registration step. Owner email verification is unchanged.
- **Invited employees skip email verification.** `inviteMemberAction` first checks
  (`emailAlreadyHasOrganization()`) that the invited email doesn't already belong to an account
  with an existing organization — **declined the alternative** of resolving that conflict at
  accept-time (asking the invitee whether to leave their current org), since one-org-per-account
  makes the block-outright case unambiguous and needs no new destructive-transfer UI. Once
  invited, the acceptance page (`/invitations/[token]`) renders a name/email-prefilled,
  password-only signup form for a guest visitor instead of linking to `/register`. On submit,
  `createAccountForInvitation()` (`organizations.service.ts`) creates the account via the
  Supabase admin API with `email_confirm: true` (the invitation link is itself the proof of
  email ownership) and immediately signs the same client in, so a real SSR session cookie is set
  before `acceptInvitation()` runs.
- **Member blocking**, distinct from `profiles.suspended_at` (a global app-admin suspension):
  `organization_members.blocked_at`, set/cleared by `block_member()`/`unblock_member()`
  (owner/admin only, not on self or the owner). Enforcement is centralized in the same RLS
  helpers everything else already gates through — `is_organization_member()` and
  `has_organization_role()` both gained `and blocked_at is null` — so a blocked member loses
  access everywhere those helpers are used, not just in the team UI. This is the same migration
  group that discovered and fixed `has_organization_write_access()` bypassing that check (it ran
  its own raw query instead of calling either helper).

## Alternatives considered

- **Allow an invite when the target account exists but has no organization yet, block only when
  they're already in one.** More permissive, but adds a state to reason about (an account that
  exists, unconfirmed, with no org) for marginal benefit; declined in favor of the simpler
  block-outright rule given the confirmed one-org-per-account model.
- **Resolve the "already in an org" conflict at accept time** (offer to leave the current org
  and join the new one). More flexible, but turns a single invite-time check into a destructive,
  user-facing transfer flow with more states to test. Declined; can be revisited if a real
  customer needs it.
- **Keep multi-org membership, just default to one.** Rejected — the whole point of this change
  is removing the switcher and the "which org am I in" ambiguity from the product entirely, not
  making single-org the default while leaving the general case supported.

## Consequences

- `getActiveOrganizationId()` (`active-organization.ts`) no longer needs a cookie — it's just
  "the org this user's single membership row points to." Every caller (api routes,
  `service-context.ts`, billing) keeps working unchanged since the function's name and return
  shape didn't change, only its (now simpler, and now actually correct) implementation.
- A blocked member's session doesn't get a dedicated "you're blocked" message yet — the team page
  falls back to its generic "not in an organization" empty state, since `getMembership()` also
  returns null under RLS for a blocked row. Acceptable for v1; revisit the copy if it causes
  support confusion.
- See also [ADR-0017's amendment](0017-per-document-visibility-and-sharing.md#amendment-2026-09-24---admin-gets-owner-equivalent-document-access)
  for the related "admin = owner for documents" extension that shipped alongside this work.
