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
| Legacy file stores | **7 active** (+1 dead, +1 seed, +1 historical) — `data/*.json` on the Railway volume; see "Persistence inventory" below |
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
- A volume is mounted at `/app/data` for the 7 active file-backed stores (see "Persistence inventory" above).
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

### Persistence inventory

> Two correction passes, same day. The first found this section had
> undercounted "two file stores" against an actual grep result of nine JSON
> files. A second pass resolved one of those nine: `campaign-placements.json`
> is read only by `scripts/seed-campaign-placements.js`, a one-time migration
> into the `CampaignPlacement` Prisma table — historical, not live
> persistence. The active count is **7**, not 9.

**Active production file-backed stores — 7:**
`data/saved-trips.json` · `data/amoe-entries.json` · `data/feedback.json` ·
`data/budget-goals.json` · `data/maintenance-reminders.json` ·
`data/announcements.json` · `data/campaign-events.json`

**Dead / unreferenced write-capable store — 1:**
`data/push-subscriptions.json` — `saveSub`/`removeSub`/`getSubs`/`getAllSubs`
in `lib/pushSubscriptions.ts` have zero callers anywhere in the repository.

**Static / build-time data — 1:**
`data/gas-prices-seed.json` — imported by `lib/gasPrices.ts` at build time,
not user data.

**Historical migration source — 1:**
`data/campaign-placements.json` — read once by
`scripts/seed-campaign-placements.js` to seed the `CampaignPlacement` table.
Nothing in the running application reads or writes it.

All 7 active stores live on the Railway volume mounted at `/app/data` and are
therefore **outside database backups**. None were migrated this sprint —
inventory and classification only. See `CLAUDE.md` → Database for the
standing rule.

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
