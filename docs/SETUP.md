# Setup

## Local Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Required Services

- Supabase project for Auth, Postgres, and Storage.
- Stripe account for Checkout, Billing, Customer Portal, and webhooks.
- An SMTP mailbox (Hostinger or any provider) for production email.

## Supabase

1. Create a Supabase project.
2. Copy project URL and publishable key into `.env.local`.
3. Copy the service-role key into `.env.local`; never expose it to browser code.
4. Run migrations with the Supabase CLI.
5. Configure auth redirect URLs for local and production app URLs.
6. Add `/auth/callback` to the redirect allow list for email verification, password reset, and
   OAuth code exchange.

## Authentication

Supported auth flows:

- Email/password registration and login.
- Email verification resend.
- Forgot/reset password.
- Google and GitHub OAuth through Supabase provider configuration.
- Optional TOTP MFA enrollment, challenge, and disable flows.
- Profile setup during onboarding.
- Password and session actions from account security settings.

## Stripe

1. Create products and prices matching `src/config/billing.ts`.
2. Configure the Customer Portal in Stripe.
3. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
4. Forward local webhooks to `/api/webhooks/stripe` during development.

## Email

Local development defaults to `EMAIL_PROVIDER=console`, which logs rendered emails instead of
sending them — no credentials required. Switch to real delivery with `EMAIL_PROVIDER=smtp` and the
`SMTP_*` variables below.

1. Set `EMAIL_FROM` to the address you want to send from (e.g. `"Your App <hello@yourdomain.com>"`).
2. Set `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASSWORD` from your mailbox provider.
3. Set `SMTP_PORT` and `SMTP_SECURE` together — they must match:
   - Port `465` with `SMTP_SECURE=true` (implicit TLS), or
   - Port `587` with `SMTP_SECURE=false` (STARTTLS).

   Mismatching them is the most common cause of an SMTP connection failing with
   "Greeting never received."
4. Optionally set `EMAIL_DEV_RECIPIENT` to reroute every outgoing email to one inbox regardless of
   the real recipient — useful for testing real delivery locally without emailing real users.

### Hostinger example

Hostinger email plans expose standard SMTP: `SMTP_HOST=smtp.hostinger.com`, `SMTP_PORT=465`,
`SMTP_SECURE=true`, with `SMTP_USER`/`SMTP_PASSWORD` set to the mailbox's own credentials. Any other
SMTP provider works the same way — nothing in the app is Hostinger-specific. See
`docs/SECURITY.md` for how the `EmailProvider` abstraction and dev-recipient override work, and
`docs/MODULES.md` for how to add another provider (e.g. a transactional API like Resend) later.
