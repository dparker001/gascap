# GasCap™ — System Architecture Guide

> **Status: CURRENT** · Last updated: 2026-08-18 (hardening sprint 1)
>
> The 2026-04-19 revision described fill-ups as living in `data/fillups.json`
> outside Prisma. That has not been true since fill-ups were migrated to
> PostgreSQL; the claim is corrected throughout rather than deleted, since the
> migration rationale is still useful history.
>
> Previously updated: 2026-04-19  
> For product feature documentation see [FEATURES.md](./FEATURES.md)  
> For referral business rules see [REFERRAL_RULES.md](./REFERRAL_RULES.md)  
> For version history see [../CHANGELOG.md](../CHANGELOG.md)

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router, TypeScript) |
| Styling | Tailwind CSS |
| Auth | NextAuth v4 — CredentialsProvider + JWT sessions |
| Database | PostgreSQL on Railway (via Prisma ORM) |
| File-based store | `data/saved-trips.json`, `data/amoe-entries.json` only — on the Railway volume at `/app/data` |
| Native | Capacitor iOS/Android shells + RevenueCat for in-app purchases |
| Payments | Stripe Checkout + Webhooks |
| Email | Gmail SMTP primary, Resend API fallback (`lib/email.ts`) |
| CRM | GoHighLevel (GHL) via REST API (`lib/ghl.ts`) |
| Gas prices | U.S. EIA Open Data API + Nominatim reverse geocode |
| AI | OpenAI GPT-4o (AI Fuel Advisor + receipt scanning) |
| PWA | next-pwa + Workbox service worker |
| Hosting | Railway (Next.js app + PostgreSQL on same project) |

---

## Directory Structure

```
/
├── app/                        # Next.js App Router pages + API routes
│   ├── page.tsx                # Main app page (calculator + all signed-in content)
│   ├── signin/                 # Sign-in page
│   ├── signup/                 # Sign-up page
│   ├── settings/               # User settings page
│   ├── fleet/                  # Fleet dashboard (/fleet)
│   ├── admin/                  # Admin panel (password-protected)
│   ├── giveaway/               # Monthly gas card giveaway page
│   ├── sweepstakes-rules/      # Official sweepstakes rules
│   ├── help/                   # Help & FAQ page
│   ├── terms/ privacy/         # Legal pages
│   └── api/
│       ├── auth/               # NextAuth + register + verify-email + reset-password
│       ├── fillups/            # Fill-up CRUD + receipt scan
│       ├── vehicles/           # Saved vehicle CRUD
│       ├── fleet/drivers/      # Fleet driver roster (GET/POST/DELETE)
│       ├── gas-price/          # EIA gas price lookup
│       ├── referral/           # Referral stats
│       ├── stripe/             # checkout / portal / webhook
│       ├── user/               # profile, price-alert, giveaway-entries
│       ├── email/              # unsubscribe
│       ├── ai/                 # AI Fuel Advisor
│       ├── admin/              # Admin user management
│       └── campaigns/          # QR placard attribution
├── components/                 # All React components
├── lib/                        # Business logic (no React)
│   ├── calculations.ts         # Pure math — never modify
│   ├── fillups.ts              # Fill-up CRUD, MPG computation, validation
│   ├── users.ts                # User CRUD, auth helpers, referral, fleet drivers
│   ├── auth.ts                 # NextAuth config
│   ├── email.ts                # sendMail() wrapper (Gmail → Resend fallback)
│   ├── emailCampaign.ts        # Drip email templates + sendCampaignEmail()
│   ├── ghl.ts                  # GHL CRM sync
│   ├── stripe.ts               # Stripe client init
│   ├── vehicleSpecs.ts         # VIN lookup types
│   └── generated/prisma/       # Auto-generated Prisma client (never edit manually)
├── prisma/
│   ├── schema.prisma           # Database schema (source of truth for DB)
│   └── config.ts               # Prisma client config
├── data/                       # Railway volume mount (/app/data)
│   ├── saved-trips.json        # Saved trips — still file-backed, no Prisma model
│   ├── amoe-entries.json       # Free sweepstakes entries (read by the draw)
│   └── gas-prices-seed.json    # Build-time seed, not user data
├── public/                     # Static assets, PWA icons, videos
├── scripts/                    # One-time utility scripts
├── docs/                       # This documentation
└── CHANGELOG.md                # Version history
```

---

## Data Storage Split

GasCap™ uses **two separate data stores** intentionally:

### Prisma / PostgreSQL (Railway)
Stores anything user-account-related:
- `User` — auth, plan, Stripe IDs, referral, fleet drivers, settings
- `Fillup` — fill-up records (**in Prisma**, see below)
- `Vehicle`, `GigFillup`, `GigMileage`, `RentalSession`, `OtpCode`,
  `GiveawayDraw`, `FavoriteStation`, `PriceReport`, `Review`, `Gift`,
  `EmailLog`, `DeviceSession`, `GaugeScanLog`, `CampaignPlacement`,
  `DeletedAccountLog` — 17 models total

### Fill-ups are in PostgreSQL — HISTORICAL note below

`lib/fillups.ts` uses `prisma.fillup` (`findMany` / `create` / `update` /
`deleteMany`). There is a `Fillup` model in `prisma/schema.prisma`.

> **HISTORICAL.** Fill-ups were originally kept in `data/fillups.json`, outside
> Prisma, to avoid a migration on a schema that was still moving. That migration
> has since happened — the file no longer exists and nothing reads it. The
> rationale is preserved because the same trade-off recurs, and because the two
> remaining file stores below are the same decision not yet unwound.

### The two file stores that DO remain

- **`data/saved-trips.json`** — `lib/savedTrips.ts`. Saved trips have no Prisma
  model. Migration candidate.
- **`data/amoe-entries.json`** — free sweepstakes entries. Compliance-relevant:
  the draw reads it as of 2026-08-17. Before that it was written and never
  read, so free entrants could not win.

Both live on the Railway volume at `/app/data` and are therefore **outside
database backups**.

---

## Authentication Flow

Two providers, both NextAuth v4 with JWT sessions.

### A. Passwordless email OTP (`credentials-otp`) — the primary path

1. `/api/otp/send` generates a **6-digit** code, stores it in the **`OtpCode`
   Postgres table** (10-minute expiry, one row per email, upsert on conflict),
   and emails it. Sending is rate limited.
2. The client calls NextAuth `signIn('credentials-otp', …)`.
3. `authorize()` in `lib/auth.ts` reads `OtpCode` over raw `pg`, validates the
   code, and **deletes the row** — codes are single-use.
4. Verification is capped at **5 attempts per email per 10 minutes**. Without
   that cap a 1,000,000-value space with a 10-minute life is brute-forcible,
   and a correct guess mints a session.
5. A user is created on first successful OTP sign-in with
   `emailVerified: true`.

> **`OtpCode` in PostgreSQL is the single source of truth.** An in-memory
> `Map` (`lib/otpStore.ts`) reachable only from an uncalled `/api/otp/verify`
> route was deleted in hardening sprint 1. Do not reintroduce a second store.

Phone verification is separate: `/api/otp/send-phone` + `/api/otp/verify-phone`,
which sets `User.phoneVerifiedAt` and awards the one-time bonus.

### B. Password (`CredentialsProvider`)

1. User submits email + password on `/signin`
2. NextAuth `CredentialsProvider` calls `authorize()` in `lib/auth.ts`
3. `authorize()` calls `findByEmail()` + `bcrypt.compare()`
4. On success, NextAuth creates a **JWT** containing `{ id, email, name, plan, emailVerified }`
5. JWT is stored in an `HttpOnly` cookie — never exposed to JavaScript
6. Every API route calls `getServerSession(authOptions)` to verify identity

### Email Verification
- On signup, a token is generated and emailed (`/api/auth/verify-email`)
- User clicks the link → token validated → `emailVerified: true` set on user
- Unverified users see a banner but can still use the app (not hard-blocked, for conversion)

### Session Staleness — security-relevant

- JWTs are stateless and cached: a plan change (upgrade, downgrade, trial
  expiry) is **not** reflected in the token until the next sign-in.
- UI components fetch the live plan rather than reading `session.user.plan`.
- **For anything that gates paid access, use `lib/serverPlan.ts`
  (`getLivePlan()`), which resolves the plan from the database.** A stale token
  otherwise grants Pro to an expired trial, or denies it to someone who just
  paid. Client-side gating is never sufficient on its own.

---

## Plans & Gating

| Plan | Price | Vehicle Slots | Fill-up Log | Receipt Scan | MPG Charts | Lifetime Exclusives |
|---|---|---|---|---|---|---|
| Free | $0 | 1 | ✅ | ❌ | ❌ | ❌ |
| Pro Monthly | $2.99/mo | Unlimited | ✅ | ✅ | ✅ | ❌ |
| Pro Lifetime | $19.99 one-time | Unlimited | ✅ | ✅ | ✅ | ✅ |
| Fleet | Coming soon (shelved) | Unlimited | ✅ | ✅ | ✅ | — |

Pro Annual was removed 2026-07-23 — strictly dominated by Lifetime, no longer purchasable. Any reference to it elsewhere is stale.

**Pro Lifetime exclusives** (not available on monthly):
- +25 bonus giveaway entries per draw month (included with base Lifetime)
- Lifetime Member badge — permanent profile badge
- Complimentary getaway certificate (100+ destinations, while `GETAWAY_ACTIVE` promo is on) — automated via Marketing Boost, see `lib/getawayPromo.ts` + `lib/marketingBoost.ts`
- Optional **Lifetime Perks** add-on ($9.99/yr): upgrades to +40 entries/month + another getaway certificate every year Perks renews

Every new signup gets a **30-day Pro trial** automatically (`grantNewSignupProTrial` in `lib/users.ts`). This sets `plan='pro'`, `isProTrial=true`, `betaProExpiry=+30d`. A cron job (or the beta-expire endpoint) reverts them to free if they don't upgrade.

---

## Stripe Integration

### Checkout Flow
1. `POST /api/stripe/checkout` — creates a Stripe Checkout Session with `metadata.userId` and `metadata.tier`
2. User completes payment on Stripe-hosted page
3. Stripe redirects to `/settings?success=1`
4. **Webhook** fires `checkout.session.completed` → `setUserPlan(userId, tier)` called
5. GHL CRM is updated with new plan tag

### Webhook Events Handled
| Event | Action |
|---|---|
| `checkout.session.completed` | Activate plan, sync GHL, notify admin |
| `invoice.payment_succeeded` | Keep plan active on renewals; award referral credit on first paid invoice |
| `customer.subscription.deleted` | Revert to free, sync GHL, notify admin |
| `invoice.payment_failed` | Revert to free, sync GHL, notify admin |
| `customer.updated` | Sync Stripe customer ID |
| `charge.dispute.created` | Alert admin, flag if referral credit was awarded |

### Fleet Trial Logic
When upgrading to Fleet, `trial_period_days` is set based on the user's current state:
- Active Pro trial → carry over remaining days
- No prior subscription → 14-day Fleet trial
- Already paid Pro subscriber → no trial (Stripe handles proration)

---

## Email System

All email goes through `lib/email.ts` → `sendMail()`:
1. Tries **Gmail SMTP** first (`GMAIL_USER` + `GMAIL_APP_PASSWORD` env vars)
2. Falls back to **Resend API** (`RESEND_API_KEY`) if Gmail fails

### Email Templates (lib/emailCampaign.ts)
| Function | Trigger | Audience |
|---|---|---|
| `sendCampaignEmail(1, ...)` | Registration | New user — welcome + trial activated |
| `sendCampaignEmail(2, ...)` | Day 3 cron | Trial users — feature deep-dive |
| `sendCampaignEmail(3, ...)` | Day 10 cron | Trial users — mid-trial check-in |
| `sendCampaignEmail(4, ...)` | Day 21 cron | Trial users — $2.99/mo upgrade offer |
| `sendCampaignEmail(5, ...)` | Day 28 cron | Trial users — final 48 hours |
| `sendReferralCreditEmail()` | Stripe webhook | Referrer — credit earned notification |

### Unsubscribe
`GET /api/email/unsubscribe?id=<userId>` sets `emailOptOut=true` on the user. Campaign emails check this flag before sending.

---

## GHL (GoHighLevel) CRM Integration

`lib/ghl.ts` exposes:
- `upsertGhlContact()` — create/update a contact with plan tags
- `updateGhlContactPlan()` — update tags when plan changes
- `upsertGhlContactWithCampaign()` — upsert with QR placard attribution data

### Plan Tags Applied
| Plan | Tags |
|---|---|
| free | `gascap-free` |
| pro (trial) | `gascap-pro`, `gascap-trial-30day` |
| pro (paid) | `gascap-pro` |
| fleet | `gascap-fleet` |

> ⚠️ Always use the `prod-ghl-mcp` connector for GHL operations, not `ghl-gascap`.

---

## Custom Window Events

Components communicate across the component tree via `window.dispatchEvent`:

| Event | Fired by | Consumed by |
|---|---|---|
| `fillup-saved` | `FillupLogger` | `FillupHistory`, `MpgChart`, `ToolsPanel`, `MpgInsightCard`, etc. |
| `vehicle-saved` | `SavedVehicles` | `SetupChecklist` |
| `gascap:switch-tools-tab` | `SetupChecklist`, `MpgInsightCard` | `ToolsPanel` |
| `gascap:focus-vehicles` | `SetupChecklist` | `SavedVehicles` |

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `NEXTAUTH_SECRET` | ✅ | JWT signing key |
| `NEXTAUTH_URL` | ✅ | Base URL (e.g., `https://www.gascap.app`) |
| `DATABASE_URL` | ✅ | PostgreSQL connection string (Railway injects automatically) |
| `GMAIL_USER` | ✅ | Gmail address for outbound email |
| `GMAIL_APP_PASSWORD` | ✅ | Gmail App Password (not account password) |
| `RESEND_API_KEY` | Recommended | Fallback email provider |
| `STRIPE_SECRET_KEY` | ✅ | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Stripe webhook signing secret |
| `STRIPE_PRICE_PRO_MONTHLY` | ✅ | Stripe Price ID for Pro monthly ($2.99/mo) |
| `STRIPE_PRICE_PRO_LIFETIME` | ✅ | Stripe Price ID for Pro Lifetime ($19.99 one-time) |
| `STRIPE_PRICE_FLEET_MONTHLY` | (shelved) | Stripe Price ID for Fleet monthly — Fleet plan inactive |
| `EIA_API_KEY` | ✅ | EIA Open Data API key (free at eia.gov/opendata) |
| `OPENAI_API_KEY` | ✅ | OpenAI API key (AI Advisor + receipt scanning) |
| `GHL_API_KEY` | ✅ | GoHighLevel API key |
| `GHL_LOCATION_ID` | ✅ | GHL sub-account location ID |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | For push | Web Push VAPID public key |
| `VAPID_PRIVATE_KEY` | For push | Web Push VAPID private key |
| `ADMIN_PASSWORD_HASH` | ✅ | bcrypt hash of admin panel password |

---

## Database Schema Summary

Key Prisma User fields (abbreviated — see `prisma/schema.prisma` for full schema):

```prisma
model User {
  id                       String    // cuid
  email                    String    @unique
  name                     String
  passwordHash             String
  plan                     String    @default("free")  // "free" | "pro" | "fleet"
  emailVerified            Boolean   @default(false)
  
  // Stripe
  stripeCustomerId         String?
  stripeSubscriptionId     String?
  
  // Trial / Beta
  isProTrial               Boolean   @default(false)
  isBetaTester             Boolean   @default(false)
  betaProExpiry            DateTime?
  
  // Referral
  referralCode             String?   @unique
  referredBy               String?
  referralCount            Int       @default(0)
  referralRewardCredited   Boolean   @default(false)
  referralCredits          Json      @default("[]")  // ReferralCredit[]
  referralProMonthsEarned  Int       @default(0)
  
  // Fleet
  fleetDrivers             String[]  @default([])
  
  // Profile
  displayName              String?
  phone                    String?
  
  // Preferences
  emailOptOut              Boolean   @default(false)
  emailCampaignStep        Int       @default(0)
  campaignEnrolledAt       DateTime?
}
```

> Fill-ups **are** in Prisma — see the `Fillup` model. `lib/fillups.ts` is the
> access layer. (An earlier revision of this document said the opposite.)

---

## Deploying Changes

```bash
# After schema changes:
npx prisma db push         # Apply to Railway PostgreSQL
npx prisma generate        # Regenerate TypeScript client

# Type-check before every commit:
npx tsc --noEmit

# Deploy = git push (Railway auto-deploys from main branch)
git push origin main
```

> Railway watches the `main` branch and rebuilds automatically on every push. Check the Railway dashboard for build logs if a deployment fails.
