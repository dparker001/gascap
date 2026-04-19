# GasCap™ — System Architecture Guide

> Last updated: 2026-04-19  
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
| File-based store | `data/fillups.json` — fill-up records (not in Prisma) |
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
├── data/
│   └── fillups.json            # Fill-up records (flat JSON, not in Prisma)
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
- No fill-up records here

### JSON File Store (`data/fillups.json`)
Stores fill-up records. Managed entirely by `lib/fillups.ts`.  
**Why JSON and not Prisma?** Fill-up records were added after the initial DB schema and the JSON approach avoids migrations while keeping reads fast for small-to-medium user counts. The tradeoff is no relational queries — all filtering happens in-process.

> ⚠️ **If you ever need to migrate fillups to PostgreSQL**, create a `Fillup` Prisma model and run a one-time migration script. All the business logic already lives in `lib/fillups.ts` — only the persistence layer would change.

---

## Authentication Flow

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

### Session Staleness
- JWTs are cached — plan changes (upgrade/downgrade) are reflected in the JWT only on next sign-in
- To get the live plan without re-signing-in, components call `GET /api/vehicles` which returns `{ plan }` from the DB directly
- This is why `FillupLogger`, `ToolsPanel`, and other components fetch live plan rather than reading from `session.user.plan`

---

## Plans & Gating

| Plan | Price | Vehicle Slots | Fill-up Log | Receipt Scan | MPG Charts | Fleet Features |
|---|---|---|---|---|---|---|
| Free | $0 | 1 | ✅ | ❌ | ❌ | ❌ |
| Pro | $4.99/mo | 3 | ✅ | ✅ | ✅ | ❌ |
| Fleet | $19.99/mo | Unlimited | ✅ | ✅ | ✅ | ✅ |

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
| `sendCampaignEmail(4, ...)` | Day 21 cron | Trial users — annual deal |
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
| `STRIPE_PRICE_PRO_MONTHLY` | ✅ | Stripe Price ID for Pro monthly |
| `STRIPE_PRICE_FLEET_MONTHLY` | ✅ | Stripe Price ID for Fleet monthly |
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

> Fill-ups are NOT in Prisma. They live in `data/fillups.json` as `Fillup[]` (see `lib/fillups.ts`).

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
