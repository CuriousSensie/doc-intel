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
