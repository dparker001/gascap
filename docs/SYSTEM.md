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
| File-based store | **7 active** (+1 dead, +1 seed, +1 historical) — see "Persistence inventory" below. On the Railway volume at `/app/data`. |
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
│   ├── push-subscriptions.json   # DEAD — zero callers, candidate for deletion
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
  `DeletedAccountLog` — 17 models total

### Fill-ups are in PostgreSQL — HISTORICAL note below

`lib/fillups.ts` uses `prisma.fillup` (`findMany` / `create` / `update` /
`deleteMany`). There is a `Fillup` model in `prisma/schema.prisma`.

> **HISTORICAL.** Fill-ups were originally kept in `data/fillups.json`, outside
> Prisma, to avoid a migration on a schema that was still moving. That migration
> has since happened — the file no longer exists and nothing reads it. The
> rationale is preserved because the same trade-off recurs, and because the two
> remaining file stores below are the same decision not yet unwound.

### Persistence inventory — corrected 2026-08-18, refined 2026-08-19

> Two correction passes. The first found this document undercounted "two file
> stores" against an actual grep result of nine JSON files. A second
> independent pass resolved one of those nine: `campaign-placements.json` is
> read only by `scripts/seed-campaign-placements.js`, a one-time migration
> into the `CampaignPlacement` Prisma table — historical, not live
> persistence. The active count is **7**.

| Store | Module | Class |
|---|---|---|
| `data/saved-trips.json` | `lib/savedTrips.ts` | **ACTIVE** — no Prisma model |
| `data/amoe-entries.json` | `lib/amoeEntries.ts` | **ACTIVE** — compliance-relevant; the draw reads it as of 2026-08-17 (before that it was written and never read, so free entrants could not win) |
| `data/feedback.json` | `lib/feedback.ts` | **ACTIVE** — session-authenticated writes |
| `data/budget-goals.json` | `lib/budgetGoals.ts` | **ACTIVE** — session-authenticated writes |
| `data/maintenance-reminders.json` | `lib/maintenance.ts` | **ACTIVE** — session-authenticated writes |
| `data/announcements.json` | `app/api/announcements/route.ts` | **ACTIVE** — `ADMIN_PASSWORD`-gated write, public read |
| `data/campaign-events.json` | `lib/campaigns.ts` | **ACTIVE** — event log, multiple writers |
| `data/push-subscriptions.json` | `lib/pushSubscriptions.ts` | **DEAD** — `saveSub`/`removeSub`/`getSubs`/`getAllSubs` have zero callers anywhere in the repo |
| `data/campaign-placements.json` | `scripts/seed-campaign-placements.js` | **HISTORICAL MIGRATION SOURCE** — read once to seed the `CampaignPlacement` Prisma table; nothing in the running app reads or writes it |
| `data/gas-prices-seed.json` | `lib/gasPrices.ts` (import) | **STATIC** — build-time seed, not user data |

**7 active production stores.** All live on the Railway volume at
`/app/data` and are therefore **outside database backups**. None were
migrated this sprint — inventory and classification only. See
`docs/SCRIPTS_INVENTORY.md` for the equivalent treatment of one-off scripts,
and `/CLAUDE.md` for the standing rule this produced: don't assert a
file-store count without re-running the grep.
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
