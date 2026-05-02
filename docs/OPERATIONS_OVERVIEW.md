# GasCap™ — Operations Overview

> Last updated: 2026-05-02
> Owner: Don Parker (admin@gascap.app)
> This document is a map — not a rulebook. Follow the links for authoritative content.

---

## Live App

| What | URL |
|---|---|
| Production app | https://www.gascap.app |
| Admin panel | https://www.gascap.app/admin |
| Railway project (caring-integrity) | https://railway.app — project ID: e56d90fe-99d6-48b1-9659-104459f54a8e |
| GitHub repo | https://github.com/dparker001/gascap |

---

## User-Facing Documentation (live on site)

| Document | URL | Purpose |
|---|---|---|
| Help & FAQ | https://www.gascap.app/help | Comprehensive user guide — single source of truth for app features |
| Terms of Service | https://www.gascap.app/terms | Legal, program rules, SMS terms, Ambassador Program terms |
| Privacy Policy | https://www.gascap.app/privacy | Data handling, GDPR/CCPA |
| Sweepstakes Rules | https://www.gascap.app/sweepstakes-rules | Official monthly drawing rules |
| Free Entry (AMOE) | https://www.gascap.app/amoe | No-purchase entry form |
| Upgrade / Pricing | https://www.gascap.app/upgrade | Plan comparison and checkout |
| Contact | https://www.gascap.app/contact | Support form + SMS opt-in |

---

## Internal Docs (`/docs` folder in repo)

| Document | File | Purpose |
|---|---|---|
| **This file** | `OPERATIONS_OVERVIEW.md` | Master map of all docs and systems |
| Chatbot Training | `CHATBOT_TRAINING.md` | Full training doc (master copy) |
| Chatbot Training Part 1 | `CHATBOT_TRAINING_PART1.md` | Sections 1–8 — upload to GHL knowledge base |
| Chatbot Training Part 2 | `CHATBOT_TRAINING_PART2.md` | Sections 9–14 — upload to GHL knowledge base |
| Pilot Partner Program | `FIELD_AMBASSADOR_PROGRAM.md` | Field rep recruiting, incentives, pitch script, placard ops |
| Placard Copy & Print Specs | `PLACARD_COPY_AND_SPECS.md` | Print specs, QR sizing, headline variants, vendor list |
| GHL Form Specs | `AMBASSADOR_GOOGLE_FORM.md` | Placement Report form fields, Sheet columns |
| GHL Automation Setup | `AMBASSADOR_GHL_AUTOMATION.md` | Workflow steps, tag reference, reward process |
| Email Templates (HTML) | `ambassador-email-templates/` | 4 HTML email files + GHL upload instructions |
| Referral Rules | `REFERRAL_RULES.md` | Ambassador Program referral logic, credit rules |
| Features Reference | `FEATURES.md` | Technical feature inventory |
| System Architecture | `SYSTEM.md` | Stack, env vars, infrastructure notes |
| Placement Tracker | `tent-card-placement-tracker.csv` | Master log — import to Google Sheets for live use |

---

## Key Third-Party Systems

| System | Purpose | Login / Access |
|---|---|---|
| **GHL (GoHighLevel)** | CRM, email automations, chatbot, SMS | app.gohighlevel.com — GasCap sub-account, Location ID: CvoeirX6lIeXP021VqmY |
| **Stripe** | Payments, subscriptions | dashboard.stripe.com |
| **Railway** | Hosting, PostgreSQL database, cron jobs | railway.app |
| **TangoCard** | Gas card reward delivery (field reps + ambassador program) | tangocard.com |
| **EIA Open Data** | Live gas price data | eia.gov/opendata |
| **Meta (Facebook/Instagram)** | Social media, ads | Pixel ID: 948950298128395 |

---

## Programs at a Glance

### Ambassador Program (in-app referral)
Documented in: `app/terms/page.tsx` (§5) · `app/help/page.tsx` (Ambassador section)

| Tier | Paying Referrals | Key Reward |
|---|---|---|
| Supporter | 5+ | 1 free Pro month per referral (cap: 6 credits) + 2× daily draw entries |
| Ambassador | 15+ | Free Pro for life + 3× daily draw entries |
| Elite Ambassador | 30+ | Free Pro for life + 5× daily draw entries + Top Ambassadors recognition |

### Monthly Gas Card Drawing
Documented in: `app/giveaway/page.tsx` · `app/sweepstakes-rules/page.tsx` · `lib/giveaway.ts`

- Entries earned: 1 per day you log in or use GasCap™ (Pro/Fleet only)
- Entries reset each month — no carryover
- Streak bonus (flat, separate from monthly entries): 7d=+2, 30d=+5, 90d=+10, 180d=+15, 365d=+20
- Prize: $25 Visa prepaid card (scales to $50 at 500 paying subscribers)
- Drawing: on or about the 5th of the following month

### Pilot Partner Program (field placard visits)
Documented in: `docs/FIELD_AMBASSADOR_PROGRAM.md`

- Field Reps visit local businesses to place GasCap™ QR tent cards/placards
- Paid per verified business location (not per placard)
- Rewards: $5 Visa prepaid card one-time per verified placement + monthly Visa prepaid card by active location count
- Tracking codes: `GC-ORGFL-D1.01-[1001+]` format · master log in `tent-card-placement-tracker.csv`
- Rewards delivered via TangoCard

---

## Email Campaigns
Documented in: `lib/emailCampaign.ts` · `lib/emailCampaignPaid.ts` · `lib/emailEngagement.ts`

| Sequence | Trigger | Steps |
|---|---|---|
| Trial drip (Steps 1–5) | Signup → `/api/auth/register` + daily cron | Welcome, feature nudge, streak intro, upgrade nudge, trial expiry |
| Paid sequence (P1–P5) | Stripe webhook (subscription created/deleted) | Upgrade confirm, tips, check-in, annual nudge, cancellation |
| Engagement track | First fillup logged | Milestone emails, MPG insights, referral nudge |

---

## A2P / SMS Status
- GHL phone: (321) 513-1321 / +13215131321
- A2P registration: submitted April 29, 2026 — pending approval
- Opt-in collected at: signup form (optional) · Settings → Profile · gascap.app/contact
- SMS consent stored as: `smsOptIn` (boolean) + `smsOptInDate` (ISO timestamp) on User record
- GHL chat widget: NOT yet installed — pending A2P approval

---

## Contacts

| Role | Name | Contact |
|---|---|---|
| Founder / Admin | Don Parker | admin@gascap.app |
| Support inbox | — | support@gascap.app |
| Registered agent | Registered Agents Inc. | 7901 4th St N STE 300, St. Petersburg FL 33702 |
| Entity | Gas Capacity LLC | EIN: 42-2058323 · Florida LLC · Orange County |
