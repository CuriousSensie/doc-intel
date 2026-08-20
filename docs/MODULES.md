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
