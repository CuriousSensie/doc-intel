# Implementation Plan

This repository is implemented incrementally, with one branch per major module and small
conventional commits inside each branch.

## Branch Sequence

1. `feat-foundation`: application scaffold, configuration, env validation, Supabase clients,
   initial schema/RLS, shared UI, CI, and docs.
2. `feat-auth`: registration, login, logout, verification, password recovery, OAuth, MFA,
   onboarding, account settings, route protection, and profile management.
3. `feat-organizations`: organizations, members, roles, permissions, invitations, workspace
   switching, and cross-tenant tests.
4. `feat-email`: Resend provider abstraction, React Email templates, and safe development email
   mode.
5. `feat-billing`: Stripe customers, Checkout, Customer Portal, subscriptions, webhooks,
   entitlements, usage limits, credits, and credit purchases.
6. `feat-notifications`: in-app notifications, notification preferences, counts, pagination, and
   service APIs.
7. `feat-files`: Supabase Storage workflows, avatar upload, file metadata, ownership, MIME/size
   validation, signed URLs, and cleanup hooks.
8. `feat-admin`: admin dashboard, audit log service, user administration, application admin roles,
   and privileged mutation audit coverage.
9. `docs-finalize`: final documentation, diagrams, setup checklist, audit fixes, and final
   verification.

Slash-style branch names are avoided in this local filesystem because Git could not create nested
refs. Hyphenated names preserve the same module boundaries.

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
