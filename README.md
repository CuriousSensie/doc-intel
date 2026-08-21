# MVP Boilerplate

Production-ready full-stack SaaS boilerplate built with Next.js, Supabase, Stripe, SMTP email, and
TypeScript.

## Quick Start

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Scripts

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

## Current Increment

This repository currently includes the foundation and auth increments: app scaffold, typed
configuration, env validation, Supabase SSR clients, initial schema/RLS, shared UI, docs, baseline
tests, auth forms, OAuth callback handling, onboarding, profile/security settings, and MFA flows.

See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) for the full module sequence.
