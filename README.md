# MVP Boilerplate

Production-ready full-stack SaaS boilerplate built with Next.js, Supabase, Stripe, Resend, and
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

This branch implements the foundation layer: app scaffold, typed configuration, env validation,
Supabase SSR clients, initial schema/RLS, shared UI, docs, and baseline tests.

See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) for the full module sequence.
