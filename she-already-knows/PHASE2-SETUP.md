# Phase 2 — Paywall, Stripe, Supabase & add-ons

Everything for Phase 2 lives on the `phase-2-paywall` branch. It ships **safe by
default**: the paywall is OFF (`PAYWALL_ENABLED = false` in `public/index.html`),
so deploying this changes nothing for beta members. The two add-ons (waitlist
tagging + remember-returning-user) are live immediately.

## What's included
- **Account + login (passwordless)** — the free first response stays open to everyone; going *deeper* requires a one-tap email account (Supabase Auth email OTP — no passwords). The card/trial gate sits behind that login, and the backend trusts the verified token, never an email from the browser.
- **Return-visit memory** — name/email saved in `localStorage`; returning users skip re-entering them.
- **Waitlist tagging** — the end-of-V2 "Save my spot" now tags into the Flodesk **waitlist** segment with the selected interests as a custom field.
- **Free trial — card up front (typical-app model)** — to unlock the deeper work, the user enters their card at Stripe Checkout, is charged **$0 today**, gets a free trial (30 days for beta emails, 7 for everyone else), and is **auto-charged $7.99 on the first day after the trial** unless they cancel. Stripe manages the trial countdown and conversion; Supabase mirrors the status via the webhook.
- **Stripe Checkout** — $7.99/month subscription with `trial_period_days` set per user.
- **Stripe webhook** — keeps subscription status (trialing → active → past_due/canceled) in sync.
- **Paywall UI** — shown to anyone without an active trial/subscription (when enabled); first-timers see "Start your N-day free trial," returners see "Continue."

## One-time setup

### 1. Supabase
1. Open Supabase → SQL Editor → run `supabase/schema.sql`.
2. Edit `supabase/seed-beta.sql` with the real beta emails (lowercase) and run it → those people get the 30-day trial.
3. **Auth → Providers → Email**: make sure Email is enabled. (The frontend already has the project URL + anon key baked in — both are public-safe.)
4. **Auth → Email Templates → "Magic Link"**: ensure the body includes the code token `{{ .Token }}` (e.g. "Your code is `{{ .Token }}`") so the 6-digit login code is in the email.
5. **Production email**: the built-in Supabase mailer is rate-limited (a few/hour) and not for production. Before launch, set a custom SMTP under **Auth → Settings → SMTP** (Resend, SendGrid, Postmark, etc.) so login codes always send.

### 2. Stripe (test mode first)
1. Create a **Product** "She Already Knows" with a **recurring $7.99/month price** → copy the `price_id`.
2. Developers → Webhooks → Add endpoint:
   `https://<your-site>/.netlify/functions/stripe-webhook`
   Events: `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_failed`. Copy the signing secret (`whsec_…`).

### 3. Netlify environment variables
Add (Site settings → Environment variables):
```
SUPABASE_URL            = https://bldxlymaykrsvxfqumrv.supabase.co
SUPABASE_SERVICE_ROLE   = <service_role key>
STRIPE_SECRET_KEY       = sk_test_…   (sk_live_… at launch)
STRIPE_PRICE_ID         = price_…
STRIPE_WEBHOOK_SECRET   = whsec_…
```
`ANTHROPIC_API_KEY` and `FLODESK_API_KEY` are already set from earlier phases.

## Going live (after beta ends)
1. Swap Stripe test keys → live keys; recreate the Product/price + webhook in live mode and update the env vars.
2. Set `PAYWALL_ENABLED = true` in `public/index.html`.
3. Merge `phase-2-paywall` → `main`. Netlify auto-deploys.

Beta members are grandfathered automatically — seed their emails into `beta_emails`
and they get the 30-day window before any charge.

## Local testing
`netlify dev` with a local `.env` (copy from `.env.example`). For webhooks use the
Stripe CLI: `stripe listen --forward-to localhost:8888/.netlify/functions/stripe-webhook`.
