# Architecture

The boilerplate uses a feature-oriented Next.js App Router architecture. Server Components are the
default rendering model, while Client Components are reserved for interactive UI.

## Directory Model

- `src/app`: routes, layouts, route handlers, loading/error states.
- `src/modules`: feature modules with services, validation, repositories, and actions.
- `src/config`: app, feature, billing, navigation, and module configuration.
- `src/lib`: shared infrastructure such as Supabase clients, env validation, errors, logging, and
  utilities.
- `src/components`: reusable UI and layout components.
- `supabase/migrations`: database schema, indexes, functions, triggers, and RLS policies.

## Dependency Direction

UI imports application/service logic. Services own business rules and call data-access helpers or
external integrations. Shared infrastructure must not import feature-specific UI.

## Security Boundaries

- Identity is derived from Supabase Auth sessions.
- RLS protects user-facing data tables.
- Service-role access is isolated to server-only modules.
- Webhooks must verify signatures and process idempotently.
- Sensitive mutations are audited where applicable.
