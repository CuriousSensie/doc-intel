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
- Resend account and verified sending domain for production email.

## Supabase

1. Create a Supabase project.
2. Copy project URL and publishable key into `.env.local`.
3. Copy the service-role key into `.env.local`; never expose it to browser code.
4. Run migrations with the Supabase CLI.
5. Configure auth redirect URLs for local and production app URLs.

## Stripe

1. Create products and prices matching `src/config/billing.ts`.
2. Configure the Customer Portal in Stripe.
3. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
4. Forward local webhooks to `/api/webhooks/stripe` during development.

## Resend

1. Verify a sending domain.
2. Set `RESEND_API_KEY` and `EMAIL_FROM`.
3. Keep `EMAIL_MODE=console` locally unless testing delivery intentionally.
