# GasCap™ Changelog

All notable changes to GasCap™ are documented here.  
Format: `[vX.Y.Z] YYYY-MM-DD — Description`  
Versions follow **Semantic Versioning**: MAJOR.MINOR.PATCH

---

## [v0.8.0] 2026-04-19 — MPG Insight Card + Referral Hardening + Onboarding

### Added
- **MPG Insight Card** (`MpgInsightCard`) — inline summary card on the main screen showing avg MPG, trend vs. prior fills, best single fill-up, tracking coverage %, and a sparkline of the last 8 readings. Auto-hides when no calculable data exists. Taps through to the Charts tab.
- **Setup Checklist** (`SetupChecklist`) — inline post-signup progress card for new signed-in users. Steps: add vehicle, log first fill-up, add driver (Fleet). Auto-checks via `vehicle-saved` / `fillup-saved` events. Celebrates completion and dismisses permanently via localStorage.
- `gascap:switch-tools-tab` custom event — any component can now switch the ToolsPanel tab programmatically.
- `gascap:focus-vehicles` custom event — opens the SavedVehicles add-vehicle picker from outside the component.
- Section anchor IDs `#gascap-calculator` and `#gascap-tools` on the main page for smooth-scroll targeting.

### Fixed
- **Referral credit race condition** — `creditVerifiedReferral` now uses `updateMany` with `WHERE referralRewardCredited=false` (atomic compare-and-swap). Duplicate Stripe webhook delivery can no longer result in double credits.
- **Referral credit trigger moved** — credit now fires on `invoice.payment_succeeded` with `amount_paid > 0` (first real payment), not on email verification. Free-plan signups and trial cancellers no longer earn referrers a credit.
- **Chargeback handler added** — `charge.dispute.created` Stripe webhook event now alerts admin immediately, flags if a referral credit was awarded, and fetches the charge to resolve the customer.
- **Referral notification email** — referrers now receive a "You earned a free month!" email the moment a referred user makes their first payment, with full credit balance, how-it-works breakdown, and expiry warning.
- Settings referral label updated from "Friends Joined" to "Paid Referrals" + explanatory copy added.

---

## [v0.7.0] 2026-04-19 — Fleet Phase 1

### Added
- **`/fleet` dashboard** — complete fleet owner view with driver roster, per-driver stats (fillups, spend, gallons, last date, vehicles used), fill-up activity table with driver + month filters, and CSV export.
- **Driver attribution** — `driverLabel` field on every fillup. Fleet users see a driver picker in the Log a Fill-Up form.
- **Driver roster API** (`/api/fleet/drivers` GET/POST/DELETE) — manage up to 10 drivers. Removing a driver preserves historical fillup labels (audit trail).
- **Fleet Dashboard link** in Settings for Fleet plan users.
- **Fleet trial logic** in Stripe checkout — carries over remaining Pro trial days when upgrading mid-trial; gives 14-day trial to new Fleet signups; no trial for paid Pro upgraders.
- FillupHistory: driver filter pill row + driver badge on each fillup row.
- `fleetDrivers String[]` field added to Prisma User model and pushed to Railway PostgreSQL.

---

## [v0.6.0] 2026-04-18 — Fill-Up Log Improvements + Profile Fix

### Added
- **Month-grouped fill-up history** — collapsible month sections, filter bar (All / This Month / Last 3 Mo / This Year / custom picker), "NOW" badge on current month, per-month spend totals.

### Fixed
- **Phone number save bug** — Settings page never fetched saved profile data on mount; every save overwrote DB values with empty strings. Fixed with new `GET /api/user/profile` endpoint and mount-time pre-population.
- Receipt scan subtitle clarified: "For pay-at-the-pump receipts or final store receipts."

---

## [v0.5.0] 2026-04-17 — Sweepstakes + Gauge Polish

### Added
- Monthly gas card giveaway system (`/giveaway` page, daily entry toast, admin draw UI).
- Winner notification email + GHL webhook trigger.
- Auto-scaling prize tiers ($25 starter → $50 at 500 paying Pro+Fleet subscribers).
- Fill-up count badge on the Log tab.
- 1/64-step gauge nudge for precision fuel level setting.
- Gauge hand changed from circle nub to perpendicular line indicator.
- Receipt scan UI: camera + gallery upload, AI auto-fill, upgrade gate for free users.

---

## [v0.4.0] 2026-04-15 — Referral System + Email Drip

### Added
- Referral code system — every user gets a unique code; signed-up-via-referral stored on new user.
- Credit model — 1 paid referral = 1 free month (up to 10 lifetime, redeemable 3 at a time, expire 6 months).
- Referral leaderboard + card in ToolsPanel.
- 5-email Pro trial drip sequence (welcome, feature deep-dive, mid-trial, 9-days-left, final 48h).
- GHL CRM sync on signup, upgrade, and cancellation.
- QR placard pilot attribution system (`/q/[code]`).

---

## [v0.3.0] 2026-04-10 — Fill-Up Logging + MPG Tracking

### Added
- Fill-up logging (`/api/fillups` GET/POST/PATCH/DELETE).
- Odometer-based MPG calculation (`computeMpg`, `getFillupStats`).
- MpgChart component (interactive SVG chart in Charts tab).
- ManualFillupLogger — tap to log from the main screen.
- Smart fill-up validation — warns on implausible gallons, duplicate dates, odometer reversals (overrideable).
- Fill-up history with delete + edit (PATCH).
- Monthly Budget Goal tracker.
- Savings Dashboard.
- Receipt scanning via AI (`/api/fillups/scan`).
- Dark mode (Auto / Light / Dark preference stored in localStorage).

---

## [v0.2.0] 2026-04-05 — Accounts, Vehicles, Gas Prices

### Added
- User accounts — NextAuth v4 with CredentialsProvider + JWT, bcryptjs password hashing.
- Email verification flow.
- Forgot password (token-based reset).
- Saved Vehicles — up to 1 (Free), 3 (Pro), unlimited (Fleet). VIN lookup for specs.
- Gas price lookup — EIA Open Data API + Nominatim reverse geocode.
- GasPriceLookup component with geolocation.
- Pro plan ($4.99/mo) and Fleet plan ($19.99/mo) via Stripe Checkout + webhook.
- 30-day Pro trial auto-granted on every new signup.
- Stripe billing portal.
- Admin panel (password-protected) — user list, plan management, beta tester flags.
- PWA manifest + service worker (next-pwa / Workbox).
- Push notification infrastructure (VAPID).

---

## [v0.1.0] 2026-03-28 — Initial MVP

### Added
- Fuel calculator (target fill mode + budget mode).
- Interactive SVG FuelGauge — drag to set fuel level, 1/64-step nudge buttons.
- Tank presets (hundreds of vehicles) + manual tank size entry.
- Rental Car Return Mode.
- Trip Cost Estimator.
- Station Comparison tool.
- AI Fuel Advisor (GPT-4o).
- Guest hero, landing content, FAQ, pricing section.
- PWA foundation (offline support).
- Railway deployment (PostgreSQL + Next.js).
