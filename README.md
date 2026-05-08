# GasCap™

**Know Before You Go**

GasCap™ is a fuel-intelligence PWA that helps drivers calculate exactly how much fuel they need and what it will cost — before they pull up to the pump. Available at [www.gascap.app](https://www.gascap.app).

---

## Tech Stack

- **Framework:** Next.js 14 App Router + TypeScript
- **Database:** PostgreSQL via Prisma ORM (Railway-hosted)
- **Auth:** NextAuth v4 (CredentialsProvider + JWT)
- **Payments:** Stripe (Pro + Fleet plans)
- **Email:** Resend
- **Push:** OneSignal
- **AI:** Anthropic Claude (AI Fuel Advisor)
- **Styling:** Tailwind CSS
- **PWA:** next-pwa + Workbox
- **Deployment:** Railway (project: caring-integrity)

## Plans

| Plan | Price | Vehicles | Key Features |
|---|---|---|---|
| Free | $0 | 1 | Calculators, gas price lookup, PWA |
| Pro | $4.99/mo or $49/yr | Up to 3 | + Rental return mode, fill-up history, MPG tracking, AI advisor, trip planner |
| Fleet | $19.99/mo or $199/yr | Unlimited | + Fleet dashboard, tax PDF, driver attribution, bulk import |

All new signups receive a 30-day Pro trial automatically.

## Development Setup

```bash
npm install
cp .env.example .env.local   # fill in required keys
npx prisma generate
npx prisma db push
npm run dev
```

Required environment variables: `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `EIA_API_KEY`, `RESEND_API_KEY`

Optional: `GASCAP_ANTHROPIC_KEY`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_TRIP_PLANNER_ENABLED`, `ONESIGNAL_REST_API_KEY`, `NEXT_PUBLIC_ONESIGNAL_APP_ID`, `GHL_API_KEY`, `GHL_LOCATION_ID`, `NEXT_PUBLIC_GA_MEASUREMENT_ID`

## Key Files

- `lib/calculations.ts` — Pure math engine (never modify directly)
- `lib/featureAccess.ts` — Feature gating by plan tier
- `lib/stripe.ts` — Pricing configuration
- `prisma/schema.prisma` — Database schema
- `lib/campaigns.ts` — QR partner campaign system
- `docs/FEATURES.md` — Full feature catalog
- `docs/SYSTEM.md` — Architecture overview

## Cron Jobs

Managed via GitHub Actions (`.github/workflows/crons.yml`). Eight daily crons: engagement-campaign, trial-expire, email-campaign, verify-reminder, paid-campaign, comp-campaign, fillup-reminder, price-alerts.

## Internal Documentation

Internal strategic documentation for growth, product planning, metrics, and acquisition-readiness is available in `/docs/acquisition-readiness`.
