# GasCap™ — System Architecture Guide

> **Status: CURRENT** · Last updated: 2026-08-18 (hardening sprint 2 — admin
> auth migration, RevenueCat idempotency + entitlement reconciliation,
> Postgres rate limiting, AMOE dual-write; see `docs/reviews/` for the review
> packet)
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
| File-based store | **7 active** (+1 seed, +1 historical) — see "Persistence inventory" below. On the Railway volume at `/app/data`. |
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
│   ├── saved-trips.json          # ACTIVE — no Prisma model
│   ├── amoe-entries.json         # ACTIVE — free sweepstakes entries (read by the draw)
│   ├── feedback.json             # ACTIVE — user-submitted feedback
│   ├── budget-goals.json         # ACTIVE — per-user budget goals
│   ├── maintenance-reminders.json # ACTIVE — per-user maintenance reminders
│   ├── announcements.json        # ACTIVE — admin-authored, read by every client
│   ├── campaign-events.json      # ACTIVE — campaign tracking event log
│   ├── campaign-placements.json  # HISTORICAL — one-time seed source only, see below
│   └── gas-prices-seed.json      # STATIC — build-time seed, not user data
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
  `DeletedAccountLog`
- Sprint 2: `RateLimitCounter`, `RevenueCatWebhookEvent`, `AdminAuditLog`,
  `AmoeEntry` (dual-write mirror, see the persistence inventory note below) —
  21 models total

### Fill-ups are in PostgreSQL — HISTORICAL note below

`lib/fillups.ts` uses `prisma.fillup` (`findMany` / `create` / `update` /
`deleteMany`). There is a `Fillup` model in `prisma/schema.prisma`.

> **HISTORICAL.** Fill-ups were originally kept in `data/fillups.json`, outside
> Prisma, to avoid a migration on a schema that was still moving. That migration
> has since happened — the file no longer exists and nothing reads it. The
> rationale is preserved because the same trade-off recurs, and because the file stores documented
> below are the same decision not yet unwound.

### Persistence inventory — corrected 2026-08-18

> Two correction passes, same day. The first found this document had
> undercounted "two file stores" against an actual grep result of nine JSON
> files. A second independent pass resolved one of those nine:
> `campaign-placements.json` is read only by `scripts/seed-campaign-placements.js`,
> a one-time migration into the `CampaignPlacement` Prisma table — historical,
> not live persistence. The active count is **7**.

| Store | Module | Class |
|---|---|---|
| `data/saved-trips.json` | `lib/savedTrips.ts` | **ACTIVE** — no Prisma model |
| `data/amoe-entries.json` | `lib/amoeEntries.ts` | **ACTIVE, dual-written to Postgres since Sprint 2** — compliance-relevant; the draw still reads the file (before 2026-08-17 it was written and never read, so free entrants could not win). Every new submission also mirrors to the `AmoeEntry` table (`lib/amoeEntriesDb.ts`, best-effort, never blocks the file write) and an idempotent backfill exists (`POST /api/admin/amoe-backfill`) — but the read-path cutover is deliberately NOT done yet; see `docs/migrations/2026-08-sprint2-amoe-backfill.md` for why and the runbook for finishing it |
| `data/feedback.json` | `lib/feedback.ts` | **ACTIVE** — session-authenticated writes |
| `data/budget-goals.json` | `lib/budgetGoals.ts` | **ACTIVE** — session-authenticated writes |
| `data/maintenance-reminders.json` | `lib/maintenance.ts` | **ACTIVE** — session-authenticated writes |
| `data/announcements.json` | `app/api/announcements/route.ts` | **ACTIVE** — `ADMIN_PASSWORD`-gated write, public read |
| `data/campaign-events.json` | `lib/campaigns.ts` | **ACTIVE** — event log, multiple writers |
| ~~`data/push-subscriptions.json`~~ | ~~`lib/pushSubscriptions.ts`~~ | **REMOVED Sprint 2** — re-confirmed zero callers, then deleted |
| `data/campaign-placements.json` | `scripts/seed-campaign-placements.js` | **HISTORICAL MIGRATION SOURCE** — read once to seed the `CampaignPlacement` Prisma table; nothing in the running app reads or writes it |
| `data/gas-prices-seed.json` | `lib/gasPrices.ts` (import) | **STATIC** — build-time seed, not user data |

**7 active production stores.** All live on the Railway volume at
`/app/data` and are therefore **outside database backups**. None were
migrated this sprint — inventory and classification only. See
`docs/SCRIPTS_INVENTORY.md` for the equivalent treatment of one-off scripts,
and `/CLAUDE.md` for the standing rule this produced: don't assert a
file-store count without re-running the grep.

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

### C. Admin authentication (Sprint 2, staged — see `docs/ADMIN_AUTH_MIGRATION.md`)

`lib/adminAuth.ts` gates all `/api/admin/*` routes plus `/api/announcements`
and `/api/push/{broadcast,digest,fillup-reminder}`:

1. **Primary path.** A valid NextAuth session where `User.role === 'admin'`
   — resolved live from PostgreSQL on every request via `sessionHasAdminRole()`,
   never trusted from the JWT (same staleness rule as `plan`, see below).
   `app/admin/page.tsx` probes this silently on load; a signed-in admin sees
   no password prompt.
2. **Legacy fallback.** The pre-Sprint-2 `x-admin-password` header, compared
   against `ADMIN_PASSWORD` with a constant-time check. Still accepted so the
   migration can't lock anyone out; not yet removed (blocked on a soak period
   — see the migration doc's step 5/6 status).
3. Both paths are OR'd — either is sufficient. Role is never read from
   request headers or client-supplied state, only the database.
4. Mutations on the highest-risk endpoints (user delete/plan-change/comp
   grant, sweepstakes draws, AMOE backfill) are recorded to `AdminAuditLog`
   via `lib/adminAudit.ts` — best-effort, never blocks the action it's
   logging.

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
| `customer.subscription.deleted` | **Sprint 2:** calls `revokeStripeSubscriptionEntitlement()`, which reverts to free only if no other entitlement source (RevenueCat, Ambassador) survives — otherwise sends an informational admin email and leaves the user Pro. Previously reverted unconditionally except for a hardcoded lifetime-interval check. |
| `invoice.payment_failed` | Revert to free, sync GHL, notify admin |
| `customer.updated` | Sync Stripe customer ID |
| `charge.dispute.created` | Alert admin, flag if referral credit was awarded |

### Fleet Trial Logic
When upgrading to Fleet, `trial_period_days` is set based on the user's current state:
- Active Pro trial → carry over remaining days
- No prior subscription → 14-day Fleet trial
- Already paid Pro subscriber → no trial (Stripe handles proration)

---

## RevenueCat Integration (native IAP)

`POST /api/native/revenuecat` is the only path to Pro on iOS/Android — see
[`feedback_revenuecat_only.md`](feedback_revenuecat_only.md) memory, never
Stripe for native features.

1. **Auth.** `Authorization` header checked against `REVENUECAT_WEBHOOK_AUTH`,
   fails closed (missing secret → 503, not silently trusted). **Sprint 2:**
   optional HMAC signature check added (`lib/revenueCatHmac.ts`) as
   defense-in-depth, off by default behind `REVENUECAT_HMAC_SECRET` — the
   exact RevenueCat signing scheme wasn't independently confirmed from this
   environment, so it isn't presented as verified until that's done.
2. **Idempotency (Sprint 2).** The raw body is read once (`req.text()`, kept
   raw so an eventual HMAC check hashes the exact bytes RevenueCat sent) then
   parsed. `lib/revenueCatEvents.ts`'s `claimEvent(event.id, ...)` atomically
   claims the event via a unique-constraint insert before any grant/revoke
   runs, and a stale-processing reclaim (2 min) lets a mid-crash event retry
   safely. A duplicate delivery of the same `event.id` is a no-op. Recent
   events are visible read-only at `GET /api/admin/revenuecat-events`.
3. **Grant.** `setUserPlan()` persists plan + the three RevenueCat
   provenance columns on `User` (`revenueCatActive/Interval/ProductId`).
4. **Revoke (Sprint 2).** Calls `revokeRevenueCatEntitlement()` instead of an
   unconditional `setUserPlan(userId, 'free')` — clears only the RevenueCat
   fields, then only actually downgrades if no other entitlement source
   (Stripe, Ambassador) survives. See "Multi-provider entitlement
   reconciliation" below.

### Multi-provider entitlement reconciliation (Sprint 2)

`lib/entitlements.ts`'s `resolveUserEntitlements()` is a pure function
consulted by both the RevenueCat and Stripe webhooks before any downgrade —
computes aggregate Pro status from Ambassador / Stripe-lifetime /
Stripe-subscription / RevenueCat-active / trial fields, so a single
provider's revocation can never wipe another provider's legitimate grant.
14 table-driven tests in `__tests__/entitlements.test.ts` cover the named
combinations (Stripe+RC both directions, Lifetime+RC-refund,
Ambassador+all-expire, gifted-lifetime+Stripe-failure). Known limitation:
gifted lifetime and real Stripe-purchased lifetime are indistinguishable in
the current schema — both collapse to `'stripe_or_gift_lifetime'`.

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
| `ADMIN_PASSWORD_HASH` | ✅ | legacy admin panel password hash — Sprint 2 added a `role`-based session path alongside it, see "Admin authentication" above; not yet removed |
| `REVENUECAT_HMAC_SECRET` | — (unset by default) | Sprint 2 — optional webhook signature verification, off until RevenueCat's exact scheme is independently confirmed; see `lib/revenueCatHmac.ts` |

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

**Per `/CLAUDE.md`: no direct pushes to `main`.** The workflow is:

```
feature/fix/hardening branch
  → npm test / npx tsc --noEmit / npm run build (all must pass)
  → pull request → required CI (.github/workflows/ci.yml)
  → Don's approval
  → merge to main
  → Railway auto-deploys from main
```

Railway watches the `main` branch and rebuilds automatically on every merge.
Check the Railway dashboard for build logs if a deployment fails.

**Schema changes:** do NOT run `prisma db push` as a routine step — see
`/CLAUDE.md` → Database: "Never blind `prisma db push`." Prefer direct,
additive SQL for production changes, document the migration impact, and
never run a destructive operation (`DROP`, `TRUNCATE`, mass `DELETE`,
`prisma migrate reset`) against production without explicit approval.
`npx prisma generate` (regenerating the TypeScript client from the schema) is
safe and routine; applying the schema to the database is the step that needs
care.
