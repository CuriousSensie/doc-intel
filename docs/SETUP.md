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

### OAuth providers (Google / GitHub)

`/login` and `/register` render Google and GitHub buttons unconditionally
(`src/app/(auth)/login/page.tsx`) — there's no env var to toggle them off individually; if a
provider isn't configured in Supabase, clicking its button fails at the OAuth exchange step
rather than being hidden. Configuration lives entirely in the Supabase dashboard, not `.env.local`:

1. **Google**: in [Google Cloud Console](https://console.cloud.google.com/), create an OAuth 2.0
   Client ID (Web application). Add your Supabase project's callback URL as an authorized redirect
   URI — it's shown on Supabase's Google provider config page, in the form
   `https://<project-ref>.supabase.co/auth/v1/callback`. Copy the Client ID and Client Secret into
   Supabase Dashboard → Authentication → Providers → Google, and enable it.
2. **GitHub**: in GitHub → Settings → Developer settings → OAuth Apps, create a new OAuth App with
   the same Supabase callback URL as its "Authorization callback URL". Copy the Client ID and
   Client Secret into Supabase Dashboard → Authentication → Providers → GitHub, and enable it.
3. In both cases, Supabase itself redirects back to **this app's** `/auth/callback` route after
   completing the provider exchange — that's already in the redirect allow list from the Supabase
   setup step above, so no extra app-side configuration is needed once the provider is enabled in
   Supabase.

## Stripe

Billing is optional (`FEATURE_BILLING`) and, when organizations are enabled, bills the active
organization rather than individual users — see the Billing section of `docs/MODULES.md` for how
that's decided.

1. In the Stripe dashboard (test mode to start), create a product for each paid plan in
   `src/config/billing.ts` (currently Pro and Team), each with a monthly and yearly recurring
   price. Copy the price ids into `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY`,
   `STRIPE_PRICE_TEAM_MONTHLY`, `STRIPE_PRICE_TEAM_YEARLY`.
2. Create a one-time price for each credit pack in `billingConfig.creditPacks`, and set
   `STRIPE_PRICE_CREDITS_STARTER`/`_GROWTH`/`_SCALE`.
3. Enable the Customer Portal (Settings → Billing → Customer Portal) so `/settings/billing`'s
   "Manage billing" button works.
4. Set `STRIPE_SECRET_KEY` from the dashboard's API keys page.
5. Create a webhook endpoint pointing at `/api/webhooks/stripe` (in production, your real domain;
   locally, use the Stripe CLI: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`,
   which prints a signing secret for local use) subscribed to at least: `checkout.session.completed`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid`. Set `STRIPE_WEBHOOK_SECRET` from it.
6. A plan with no price id configured shows a disabled "Contact us" button on `/pricing` and
   `/settings/billing` instead of a broken Checkout link — that's expected until its price ids are
   set, not a bug.

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

## Deployment

This is a standard Next.js app — any host that runs `next build`/`next start` (or the Next.js
runtime directly) works. The steps below are for **Vercel + Supabase production**, the path with
the least friction, but nothing here is Vercel-specific beyond step 1.

1. **Push the repo** to GitHub/GitLab/Bitbucket and import it into Vercel (or run `vercel` from
   the CLI). Vercel auto-detects Next.js — no build config needed beyond the env vars below.
2. **Create a second, production Supabase project** (don't reuse your local-dev project) and run
   every migration against it in order, exactly as in the Supabase setup section above.
3. **Set every environment variable from `.env.example`** in your host's dashboard (Vercel:
   Project → Settings → Environment Variables), pointed at production values:
   `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_SERVICE_ROLE_KEY`
   for the production Supabase project; `STRIPE_SECRET_KEY` + a **new** production webhook secret
   (see below); `SMTP_*` (or leave `EMAIL_PROVIDER=console` unset only if you're fine without
   real email in production, which you almost certainly aren't); `NEXT_PUBLIC_APP_URL` set to your
   real production domain — several redirect/absolute-URL helpers (`absoluteUrl()`, email links,
   OAuth redirects) depend on this being correct.
4. **Add the production URL to Supabase's redirect allow list** (Authentication → URL
   Configuration) — the same `/auth/callback` entry as local dev, but with your production domain.
5. **Create a second Stripe webhook endpoint** pointed at
   `https://<your-domain>/api/webhooks/stripe` (production webhooks and the local Stripe CLI
   listener use *different* signing secrets — don't reuse the local one). Set the new secret as
   `STRIPE_WEBHOOK_SECRET` in production.
6. **Switch Stripe to live mode** (separate API keys and price IDs from test mode) once you're
   ready to accept real payments — test-mode and live-mode Stripe objects don't share IDs, so
   `STRIPE_PRICE_*` needs updating too.
7. Deploy. Then run through the manual verification steps at the end of each module's section in
   `docs/IMPLEMENTATION_PLAN.md` against the production URL at least once before announcing
   launch — automated tests cover logic, not "does the Stripe webhook actually reach this domain."

## New Product Checklist

Starting a new product from this boilerplate (as opposed to setting up this exact clone for local
dev — the rest of this file) — copy this list and work through it top to bottom:

- [ ] **Rename the project**: `package.json` `name`, `src/config/app.ts`'s `name`/`description`/
      `supportEmail`, and `NEXT_PUBLIC_APP_NAME` in `.env.local`/production env.
- [ ] **Branding**: swap `src/config/app.ts`'s `logo`/`social` entries and anything under
      `src/emails/layout.tsx` (the shared email header/footer) for your own.
- [ ] **Decide your product mode**: organizations enabled (B2B — the org pays, individual members
      never pay) or disabled (B2C — each user pays individually). This is one flag,
      `featureConfig.organizations` in `src/config/features.ts` — everything billing-related
      derives from it (see [ARCHITECTURE.md#owner-polymorphic-billing](ARCHITECTURE.md#owner-polymorphic-billing)).
      Don't run with organizations "sort of" on — it's a binary product decision, not a per-feature toggle.
- [ ] **Turn off modules you don't need**: flip the rest of `src/config/features.ts` — a disabled
      module's nav entries disappear and its routes throw `AuthorizationError` via
      `requireFeature()`, but its code stays in the repo (delete the directory yourself later if
      you're sure you'll never need it back).
- [ ] **Create your own Supabase project** (not the one you used to develop against) and run every
      migration — see [Supabase](#supabase) above.
- [ ] **Set every env var** for your new Supabase/Stripe/SMTP — see the sections above; don't
      carry over development credentials.
- [ ] **Configure OAuth providers** you actually want (or leave Google/GitHub configured — see
      [OAuth providers](#oauth-providers-google--github) — but note the buttons render
      unconditionally, so either configure both or accept that an unconfigured one will error).
- [ ] **Set your email sending domain**: `EMAIL_FROM`, and your SMTP provider's domain
      authentication (SPF/DKIM) — outside this app's scope, but required for real deliverability.
- [ ] **Create your real Stripe products/prices**: edit `src/config/billing.ts`'s `plans` and
      `creditPacks` to match your actual pricing, then create matching Stripe Products/Prices and
      set the `STRIPE_PRICE_*` env vars — see [Stripe](#stripe) above.
- [ ] **Review `src/config/billing.ts`'s `PlanFeatureMap`** (`teamMembers`, `projects`,
      `storageMb`, `credits`) — these are the actual entitlement limits `checkUsageLimit()`
      enforces; the boilerplate's defaults are placeholders, not real numbers for any real
      product.
- [ ] **Set `NEXT_PUBLIC_APP_URL`** to your real production domain before deploying — see
      [Deployment](#deployment).
- [ ] **Run the full verification suite** (`npm run lint && npm run typecheck && npm test && npm
      run build && npm run test:e2e`) against your configuration before considering setup done.
- [ ] **Deploy** — see [Deployment](#deployment) above.
- [ ] **Promote yourself to application admin**: set your own `profiles.is_app_admin = true`
      directly in the database (there's deliberately no self-service path — see
      [SECURITY.md#admin](SECURITY.md#admin)) if you're using the Admin module.
