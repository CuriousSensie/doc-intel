# MVP Boilerplate

A production-ready, full-stack SaaS boilerplate built with **Next.js (App Router)**, **Supabase**
(Postgres, Auth, Storage), **Stripe**, SMTP email, and **TypeScript**. It's designed to be cloned
and shaped into a specific product — not a framework you configure once and never touch again.

Every module is feature-flagged, RLS-first, and documented well enough that you can rip one out,
extend one, or swap a piece of infrastructure (an email or storage provider, for example) without
reading the rest of the codebase first.

## Documentation

Start here, in this order, depending on what you need:

| Doc | Read this when you want to... |
| --- | --- |
| [docs/SETUP.md](docs/SETUP.md) | Get this running locally, connect it to real Supabase/Stripe/SMTP, deploy it, or start a brand-new product from this boilerplate. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Understand how a request flows through the app, how modules are laid out, and the key design decisions (and why). |
| [docs/DATABASE.md](docs/DATABASE.md) | See the full schema — every table, column, function, enum, and the ER diagram. |
| [docs/MODULES.md](docs/MODULES.md) | Understand what a specific module does, how to enable/disable it, and how to extend it. |
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md) | Look up the exact signature of a function before calling or modifying it. |
| [docs/SECURITY.md](docs/SECURITY.md) | Understand the auth/authorization model, RLS design, and why a sensitive operation is implemented the way it is. |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | See the module build sequence and each module's acceptance criteria. |

## Tech stack

- **Framework**: Next.js (App Router, Server Components, Server Actions, Route Handlers)
- **Language**: TypeScript, strict mode
- **Database/Auth/Storage**: Supabase (Postgres + Row Level Security, Supabase Auth, Supabase
  Storage)
- **Payments**: Stripe (Checkout, Customer Portal, webhooks)
- **Email**: a pluggable `EmailProvider` abstraction — `console` (dev default, no credentials
  needed) or `smtp` (any SMTP host) out of the box, via React Email templates
- **Validation**: Zod, for both environment variables and form input
- **Styling**: Tailwind CSS
- **Testing**: Vitest (unit) + Playwright (e2e)

## Project structure

```
src/
  app/                      Next.js App Router routes, grouped by concern
    (marketing)/             Public marketing pages (/, /pricing)
    (auth)/                  Auth pages (/login, /register, /mfa/*, ...)
    (dashboard)/              Authenticated app (/dashboard, /settings/*, /organizations)
    (admin)/                  Application-admin section (/admin/*), one shared layout gate
    api/                      Route handlers (health check, Stripe webhook, file downloads)
  modules/                  Domain logic, one directory per module
    auth/                     Session, authorization, server actions, Zod schemas
    organizations/            Multi-tenancy: orgs, members, roles, invitations
    email/                    sendEmail() + typed template registry
    billing/                  Stripe customers/subscriptions/checkout, usage limits, credits
    notifications/            In-app notifications
    files/                    Supabase Storage uploads, avatars
    admin/                    Admin-only user/org/billing management + audit log reads
    users/                    Profile data access shared by auth and other modules
  lib/                      Framework-agnostic infrastructure, no business logic
    supabase/                 The three Supabase client factories (server/admin/browser) + middleware
    email/                    EmailProvider interface + console/SMTP implementations
    events/                   logEvent() — the pluggable event/audit-log dispatcher
    files/                    File validation (MIME sniffing, size limits)
    stripe/                   Stripe SDK client factory
    env.ts, errors.ts, logger.ts, pagination.ts, utils.ts
  config/                   Typed, static configuration (no I/O)
    features.ts               Feature flags — the on/off switch for every optional module
    billing.ts                 Plans, credit packs, billing-owner-type derivation
    files.ts                   Upload size/MIME allowlists per category
    navigation.ts               Nav entries, each optionally gated by a feature flag
  emails/                   React Email templates + shared layout
  components/               Shared UI (forms, buttons, layout chrome)
  types/database.ts         Hand-maintained Supabase schema types (Database, Json)
supabase/migrations/       SQL migrations, applied in filename order
e2e/                       Playwright specs (one file per module, guard-redirect style)
docs/                      Everything listed in the table above
```

## Module overview

Every module is gated by a flag in `src/config/features.ts` (`isFeatureEnabled("...")`). See
[docs/MODULES.md](docs/MODULES.md) for the full detail on each.

| Module | Default | Depends on |
| --- | ---: | --- |
| Authentication | Required | Supabase |
| Profiles | Required | Auth |
| Email | Required | SMTP (optional — falls back to console logging) |
| Organizations | Optional | Auth |
| RBAC | Optional | Organizations |
| Billing | Optional | Stripe |
| Credits | Optional | Billing |
| Files | Optional | Supabase Storage |
| Notifications | Optional | Auth |
| Admin | Optional | Auth |
| Audit Logs | Recommended | — (`src/lib/events/` has no dependency on Admin) |

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

The app boots with zero external credentials configured: Supabase-backed features degrade to
guest-only pages, and email defaults to logging to the console. See
[docs/SETUP.md](docs/SETUP.md) for connecting real Supabase/Stripe/SMTP, and its **New Product
Checklist** for turning this into your own product.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build (`next build --webpack`) |
| `npm run start` | Start the production server (after `build`) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Run the Vitest unit/integration suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Playwright end-to-end suite |
| `npm run format` | Check formatting with Prettier |
| `npm run format:write` | Apply Prettier formatting |

Every module in this repo was built to pass `lint`, `typecheck`, `test`, `build`, and `test:e2e`
before being considered done — that's the bar for any change here too.
