# GasCap™ — Know Before You Go

GasCap™ is a free, installable Progressive Web App (PWA) that tells drivers exactly how many gallons to pump and what it will cost — eliminating guesswork at the pump. It includes live gas prices, saved vehicles, fill-up history with MPG tracking, and Pro/Fleet subscription tiers with advanced features.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 App Router (TypeScript) |
| Styling | Tailwind CSS |
| Auth | NextAuth v4 (JWT, CredentialsProvider) |
| Data store | JSON flat-file (users, vehicles, fill-ups, trips) in `data/` |
| Analytics DB | Prisma + PostgreSQL (analytics events only) |
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

Runs the Vitest test suite targeting `lib/calculations.ts`. Tests cover `round()`, `calcTargetFill()`, `calcBudget()`, `validateTargetFill()`, and `validateBudget()` — including edge cases (already full, overfill, price=0, gallons precedence over percent).

---

## Deployment

The app runs on **Railway** as a single service. All environment variables are set in the Railway dashboard.

Push to `main` triggers an automatic deploy. The Railway service is bound to `www.gascap.app`.

Key Railway details:
- Project: `caring-integrity`
- Cron jobs for email drip (`/api/cron/email-campaign`) and paid sequence (`/api/cron/paid-campaign`) run on Railway's cron scheduler.

---

## Data

User data is stored in flat JSON files in the `data/` directory:

- `data/users.json` — accounts, hashed passwords, plan, trial status
- `data/vehicles.json` — saved vehicles per user
- `data/fillups.json` — fill-up log entries
- `data/trips.json` — trip planner saved routes

**Prisma** is used exclusively for analytics event logging (a separate PostgreSQL database). No PII beyond email, name, and optional phone is stored.

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
