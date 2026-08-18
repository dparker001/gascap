# GasCap™ — Know Before You Go

GasCap™ is a free, installable Progressive Web App (PWA) that tells drivers exactly how many gallons to pump and what it will cost — eliminating guesswork at the pump. It includes live gas prices, saved vehicles, fill-up history with MPG tracking, and Pro/Fleet subscription tiers with advanced features.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 App Router (TypeScript) |
| Styling | Tailwind CSS |
| Auth | NextAuth v4 (JWT sessions; password + passwordless email OTP) |
| Data store | **PostgreSQL via Prisma** — 17 models, system of record |
| Legacy file stores | **9 found** — `data/*.json` on the Railway volume; see "Nine runtime JSON stores" below |
| Native apps | Capacitor iOS + Android shells loading the deployed web app |
| Native purchases | RevenueCat (Apple IAP / Google Play Billing) |
| Deployment | Railway (single service, auto-deploy from `main`) |
| Payments | Stripe (subscriptions, webhooks, customer portal) |
| Email | Resend (transactional + drip campaigns) |
| Push notifications | OneSignal |
| Gas price data | EIA Open Data API + Nominatim reverse geocode |
| Maps / routing | Google Maps Routes API |
| PWA | next-pwa + Workbox |

---

## Key Features

- **Calculators** — Target Fill (pump exactly X gallons to reach Y%) and Budget (how far does $Z go?)
- **Rental Car Return Mode** — fill to a specific level before returning a rental
- **Live Gas Prices** — real-time EIA data, located by browser geolocation (Nominatim)
- **Saved Vehicles** — Free tier: 1 vehicle; Pro: unlimited
- **Fill-Up History & MPG Tracking** — log every fill-up, track miles per gallon over time
- **Smart Fill-Up Optimizer** — recommends when and how much to fill based on price trends
- **Route-Based Trip Planner** — estimate fuel cost for a trip with Google Maps routing (Pro)
- **Gas Price Drop Alerts** — OneSignal push notifications when local prices drop (Pro)
- **AI Fuel Advisor** — personalized tips powered by Anthropic Claude
- **Receipt Scan** — AI vision parses pump receipts automatically
- **VIN Scan** — decode vehicle specs from VIN barcode
- **Badge Achievements** — gamified milestones for fill-up streaks and savings
- **Referral Program** — users earn credits for referring friends who convert to paid
- **Monthly Giveaway** — sweepstakes entry for active users
- **Fleet Dashboard** — multi-vehicle management for commercial accounts

---

## Architecture

- **`lib/calculations.ts`** — pure math engine; no imports, no side effects. All fuel math lives here and is fully unit-tested.
- **`lib/featureAccess.ts`** — single source of truth for plan-based feature gating (free / pro / fleet).
- **`lib/emailCampaign.ts`** — 5-step trial drip sequence (steps 1–5, fired from register API and daily cron).
- **`lib/emailCampaignPaid.ts`** — 5-step paid subscriber sequence (P1–P5, fired from Stripe webhooks and daily cron).
- **`lib/gtag.ts`** — GA4 event helpers; all analytics event calls go through here.
- **`lib/rateLimit.ts`** — in-memory rate limiter (single-instance; replace Map with Redis for multi-instance).

---

## Local Development

### Prerequisites

- Node.js 18+ (project targets Node 20)
- npm

### Setup

```bash
git clone <repo-url>
cd vnetcard-gascap-mvp
npm install
cp .env.local.example .env.local
# Fill in the required env vars (see below)
npm run dev
```

### Required Environment Variables

| Variable | Description |
|---|---|
| `NEXTAUTH_SECRET` | Random secret for JWT signing (generate with `openssl rand -base64 32`) |
| `NEXTAUTH_URL` | App base URL, e.g. `http://localhost:3000` |
| `EIA_API_KEY` | Free key from [eia.gov/opendata](https://www.eia.gov/opendata/) |
| `STRIPE_SECRET_KEY` | Stripe secret key (test or live) |
| `STRIPE_PRICE_PRO_MONTHLY` | Stripe Price ID for Pro monthly plan ($2.99/mo) |
| `STRIPE_PRICE_PRO_LIFETIME` | Stripe Price ID for Pro Lifetime plan ($19.99 one-time) |
| `STRIPE_PRICE_FLEET_MONTHLY` | Stripe Price ID for Fleet monthly (shelved — Fleet inactive) |
| `RESEND_API_KEY` | Resend API key for transactional email |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Google Analytics 4 Measurement ID |
| `GOOGLE_MAPS_API_KEY` | Google Maps API key (Routes API enabled) |
| `GOOGLE_MAPS_TRIP_PLANNER_ENABLED` | Set to `true` to enable trip planner |
| `GHL_API_KEY` | GoHighLevel Private Integration Token |
| `GHL_LOCATION_ID` | GHL sub-account location ID |
| `ONESIGNAL_APP_ID` | OneSignal app ID for push notifications |
| `ONESIGNAL_API_KEY` | OneSignal REST API key |

---

## Testing

```bash
npm test
```

Runs the Vitest suite in `__tests__/`. Coverage spans the fuel calculators,
rental-return calculations, the RevenueCat webhook's authentication and
entitlement transitions, sweepstakes/AMOE entrant identity, streak tiers, photo
size limits and tank-size plausibility.

Also run, for any material change:

```bash
npx tsc --noEmit
npm run build
```

`npm run lint` is currently **not usable** — `next lint` with no ESLint config
drops into an interactive setup prompt. It is deliberately excluded from CI;
see `.github/workflows/ci.yml`.

CI (`.github/workflows/ci.yml`) runs install → cron-inventory guard → tests →
typecheck → build on every PR to `main`.

---

## Deployment

The app runs on **Railway** as a single service. All environment variables are set in the Railway dashboard.

Push to `main` triggers an automatic deploy. The Railway service is bound to `www.gascap.app`.

Key Railway details:
- Project: **`caring-integrity`** — the only project serving www.gascap.app.
- A volume is mounted at `/app/data` for the two remaining file stores.
- **Scheduled jobs run from GitHub Actions** (`.github/workflows/crons.yml`),
  not Railway's scheduler — 18 `/api/cron/*` endpoints, 16 scheduled. Each is
  authenticated with `CRON_SECRET` and fails closed without it.
  `npm run check:crons` guards route/schedule drift at build time.

**Merging to `main` is a production deploy.** See `/CLAUDE.md`.

---

## Data

**PostgreSQL via Prisma is the system of record.** The flat-file store described
in earlier revisions of this README is gone; `data/users.json`,
`data/vehicles.json`, `data/fillups.json` and `data/trips.json` no longer exist
and nothing reads them.

`prisma/schema.prisma` defines 17 models, including:

| Model | Holds |
|---|---|
| `User` | accounts, hashed passwords, plan, trial state, streak/activeDays, giveaway bonus counters |
| `Vehicle` | saved vehicles |
| `Fillup` | fill-up log entries (**not** a JSON file) |
| `GigFillup`, `GigMileage` | gig-driver logs |
| `RentalSession` | Rental Return Assistant sessions |
| `OtpCode` | passwordless sign-in codes — the single OTP source of truth |
| `GiveawayDraw` | recorded monthly draws |
| `FavoriteStation`, `PriceReport`, `Review`, `Gift`, `EmailLog`, … | supporting records |

### Nine runtime JSON stores remain — not two

> **Corrected 2026-08-18 after independent review.** An earlier revision of
> this section named only two file stores. A full sweep for
> `fs.writeFile(Sync)`/`fs.appendFile(Sync)` across `lib/` and `app/api/`
> found seven more. See `docs/SCRIPTS_INVENTORY.md` history and
> `docs/SECURITY_AUDIT.md` for the audit method.

| Store | Module | Written by | Class |
|---|---|---|---|
| `data/saved-trips.json` | `lib/savedTrips.ts` | `POST /api/trips` | **ACTIVE PRODUCTION PERSISTENCE** — user data, no Prisma model |
| `data/amoe-entries.json` | `lib/amoeEntries.ts` | `POST /api/amoe` | **ACTIVE PRODUCTION PERSISTENCE** — compliance-relevant, read by the sweepstakes draw |
| `data/feedback.json` | `lib/feedback.ts` | `POST /api/feedback` | **ACTIVE PRODUCTION PERSISTENCE** — user-submitted, read by `/api/admin/feedback` |
| `data/budget-goals.json` | `lib/budgetGoals.ts` | `POST /api/budget-goal` | **ACTIVE PRODUCTION PERSISTENCE** — per-user, session-authenticated |
| `data/maintenance-reminders.json` | `lib/maintenance.ts` | `POST /api/maintenance` | **ACTIVE PRODUCTION PERSISTENCE** — per-user, session-authenticated |
| `data/announcements.json` | `app/api/announcements/route.ts` (inline) | `POST /api/announcements` | **ACTIVE PRODUCTION PERSISTENCE** — admin-authored, read by every client on load |
| `data/campaign-events.json` | `lib/campaigns.ts` | multiple campaign-tracking routes | **ACTIVE PRODUCTION PERSISTENCE** — event log, several writers |
| `data/push-subscriptions.json` | `lib/pushSubscriptions.ts` | *(none found)* | **DEAD / UNREFERENCED CODE** — `saveSub`/`removeSub`/`getSubs`/`getAllSubs` have zero callers anywhere in the repo |
| `data/gas-prices-seed.json` | `lib/gasPrices.ts` (import) | build-time only | **STATIC / SEED DATA** — not user data, imported at build |
| `data/campaign-placements.json` | — | — | present in repo tree; not yet traced to a specific writer/reader as part of this pass — **UNKNOWN**, needs its own check |

**Nine distinct runtime JSON stores were found, not two.** Seven are active
production persistence, one (`push-subscriptions.json`) is dead code with a
plausible live-looking module around it, one is a build-time seed, and one
(`campaign-placements.json`) is unclassified pending further inspection.

All active stores live on the Railway volume mounted at `/app/data` and are
therefore **outside database backups.** `.dockerignore` excludes `data/*.json`
from the image except the seed file, confirming these are runtime-only,
volume-persisted files, not baked into deploys.

None of these were migrated this sprint — inventory and classification only,
per sprint scope. See `CLAUDE.md` → Database for the standing rule.

### Authentication

NextAuth v4 with JWT (stateless — no server session table), offering:

- **Password** — bcrypt hash on `User.passwordHash`
- **Passwordless email OTP** — `/api/otp/send` writes a 6-digit code to
  `OtpCode`; the `credentials-otp` provider in `lib/auth.ts` reads, validates
  and consumes it. Capped at 5 verification attempts per email per 10 minutes.

Because sessions are stateless, a JWT carries a **stale plan** after an upgrade
or expiry. Anything gating paid access must resolve the plan from the database
— see `lib/serverPlan.ts`.

### Payments

- **Web** — Stripe Checkout + customer portal; `/api/stripe/webhook` verifies
  the signature.
- **iOS / Android** — **RevenueCat only**, never Stripe.
  `/api/native/revenuecat` grants and revokes Pro. It fails closed: a missing
  `REVENUECAT_WEBHOOK_AUTH` refuses the request rather than trusting it.

---

## Pricing

| Plan | Price | Notes |
|---|---|---|
| Free | Free forever | 1 vehicle, all calculators |
| Pro | $2.99/mo | Unlimited vehicles, all Pro features |
| Pro Lifetime | $19.99 one-time | Own Pro forever — no subscription |
| Fleet | Coming soon | Shelved — Pro now includes unlimited vehicles |

All new signups receive a 30-day Pro trial automatically.

---

## License / Contact

Gas Capacity LLC · [admin@gascap.app](mailto:admin@gascap.app)
