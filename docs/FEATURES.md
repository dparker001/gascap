# GasCap™ — Feature Catalog

> Last updated: 2026-05-02  
> See [SYSTEM.md](./SYSTEM.md) for technical architecture.

Each feature lists: what it does, which plan unlocks it, and where it lives in the codebase.

---

## Core Calculator

**Plan:** Free (all users including guests)  
**Component:** `CalculatorTabs` → `TargetFillForm` / `BudgetForm`

Two modes:
- **Target Fill** — "I want to fill to X%, I'm currently at Y%. How much will it cost?" Uses the interactive FuelGauge to set current level, a target fill selector, and tank size (from saved vehicle or manual entry).
- **Budget Mode** — "I have $40. How many gallons and what fill level will that get me?"

The gauge is a draggable SVG arc (195°→345°, 150° sweep). Drag the needle or use nudge buttons (1/64-step = ~1.56% per tap). All math lives in `lib/calculations.ts` — that file is never modified directly.

---

## Gas Price Lookup

**Plan:** Free  
**Component:** `GasPriceLookup`  
**API:** `GET /api/gas-price`

Fetches the user's local regular unleaded price from the **EIA Open Data API**, localized to their state using Nominatim reverse geocoding from the browser's GPS. Falls back to national average if geolocation is denied. Cached per session to avoid rate limits.

---

## Saved Vehicles (Garage)

**Plan:** Free (1 slot), Pro (3 slots), Fleet (unlimited)  
**Component:** `SavedVehicles`  
**API:** `GET/POST/DELETE/PATCH /api/vehicles`

Users save vehicles with name, tank size (gallons), year/make/model, trim, fuel type, VIN (optional), and current odometer. Selecting a saved vehicle pre-fills the calculator. VIN lookup fetches manufacturer specs (EPA MPG estimates, engine, etc.) from `/api/vin`.

Fires `vehicle-saved` window event on successful save (consumed by `SetupChecklist`).  
Listens for `gascap:focus-vehicles` event to auto-open the add-vehicle form (used by `SetupChecklist`).

**Garage Door Session Persistence (Pro/Fleet):** The animated garage door stays open for the entire browser tab session. State is backed by `sessionStorage('gascap:garage-open')`, so it survives component remounts and page scrolling. Resets only when the tab is closed, the page is hard-refreshed, or the user logs out.

---

## Fill-Up Logging

**Plan:** Free (log only), Pro/Fleet (full history, MPG, charts)  
**Component:** `ManualFillupLogger` → `FillupLogger`  
**API:** `GET/POST/PATCH/DELETE /api/fillups`

Users log each fill-up with: date, gallons, price/gal, odometer reading (optional but recommended for MPG), notes, and driver label (Fleet only).

**Smart validation** runs on every save and warns (but allows override with "Save Anyway") on:
- Gallons unusually high or low for the vehicle's tank size
- Duplicate date
- Odometer reading lower than last recorded (possible wrong entry)
- Implausible price per gallon

**Receipt scanning** (`/api/fillups/scan`) — Pro/Fleet only — uploads a photo of a gas receipt and uses GPT-4o Vision to extract gallons, price/gallon, and date. Values are pre-filled into the form for review before saving.

Fires `fillup-saved` window event on save (consumed by ~8 components for live refresh).

---

## Fill-Up History

**Plan:** Free (basic list), Pro/Fleet (full filtering, month grouping)  
**Component:** `FillupHistory`

Displays fillups grouped by month with collapsible sections. Filter bar: All / This Month / Last 3 Mo / This Year / custom month picker. Each row shows date, vehicle, gallons, price/gal, total cost, MPG (if calculable), driver (Fleet), and a delete button.

Fleet users get an additional driver filter pill row above the month groups.

---

## MPG Tracking

**Plan:** Free (calculation available if odometer data exists), Pro (full charts)  
**Logic:** `lib/fillups.ts` — `computeMpg()`, `getFillupStats()`  
**Components:** `MpgInsightCard`, `MpgChart`

MPG is calculated between consecutive fill-ups that both have odometer readings:
`mpg = (odometerCurrent - odometerPrevious) / gallonsPumped`

Only fill-ups for the same vehicle are paired. The result is stored in `mpgMap` (a `Record<fillupId, number | null>`) returned by the API.

**MpgInsightCard** — inline summary card on the main screen showing avg MPG, trend vs. prior fills, best single fill-up, tracking coverage, and a sparkline. Only appears when at least one MPG value is calculable. Taps to the Charts tab.

**MpgChart** — full interactive SVG chart in the Charts tab (Pro+). Shows trend line, tooltips, vehicle filter.

---

## Fleet Dashboard

**Plan:** Fleet only  
**Page:** `/fleet`  
**API:** `/api/fleet/drivers` (GET/POST/DELETE)

Fleet owners manage a driver roster (up to 10 drivers). Each fill-up can be attributed to a driver via a dropdown in the Log form.

Dashboard shows:
- Overview stats: active drivers, vehicles, this-month spend, all-time spend
- **Driver Roster card** — add/remove drivers, per-driver stats (fillups, spend, gallons, last fill date, vehicles used)
- **Fill-up Activity card** — driver + month filters, sortable table, CSV export with driver column
- Unattributed fill-up warning

Driver names are stored as `String[]` on the User model (`fleetDrivers`). Removing a driver does NOT delete their historical `driverLabel` values on fill-ups (preserved for audit).

### Fleet White-Label Branding

**Plan:** Fleet only  
**API:** `GET/PATCH /api/fleet/branding`

Fleet subscribers can set a company name and logo URL in **Settings → Fleet Branding**. The company name and logo appear in the desktop dashboard header as a corporate identity bar. "Powered by GasCap™ Fleet" attribution is displayed alongside the branding. Fields stored on the User model: `fleetCompanyName`, `fleetLogoUrl`.

---

## Referral Program

**Plan:** All plans can refer; credits only redeemable on Pro/Fleet  
**Component:** `ReferralCard`  
**API:** `GET /api/referral`

See [REFERRAL_RULES.md](./REFERRAL_RULES.md) for full business logic.

Summary:
- Every user gets a unique referral code (`/signup?ref=CODE`)
- **1 paid referral = 1 credit = 1 free month** of Pro
- Credits awarded when the referred user makes their **first real Stripe payment** (not on signup, not during trial)
- Up to 10 credits earned lifetime; redeem up to 3 at a time; expire 6 months from earning
- Referrer receives an email notification the moment a credit is earned

---

## Monthly Gas Card Giveaway (Sweepstakes)

**Plan:** Pro and Fleet users only  
**Page:** `/giveaway`  
**Admin:** `/admin` → Draw section

Pro/Fleet users earn 1 entry per calendar day they open the app (tracked via `GET /api/activity`). Up to 31 entries per month.

- One winner drawn per month
- Prize starts at $25; scales to $50 once 500+ paying Pro/Fleet subscribers are active
- Winner is notified by email and via GHL webhook
- Official rules at `/sweepstakes-rules`
- Free entry via mail-in (AMOE) available at `/giveaway#free-entry`

---

## Onboarding Setup Checklist

**Plan:** All signed-in users (one-time)  
**Component:** `SetupChecklist`

Appears inline on the main screen for signed-in users who haven't completed setup. Three steps:
1. Add your first vehicle
2. Log your first fill-up  
3. Add a driver (Fleet only)

Each step CTA fires a custom event to open the relevant form and scroll to it. Steps auto-check in real-time via window events. Permanently dismissable via localStorage (`gascap_setup_v1`). Celebrates with a 🎉 banner when all steps complete, then auto-dismisses.

---

## Email Drip Sequence

**Trigger:** Every new signup  
**5 emails over 28 days** (skips if user upgrades before the send date):

| Step | Timing | Subject |
|---|---|---|
| 1 | Immediate | Welcome + Pro trial activated |
| 2 | Day 3 | Feature deep-dive (AI, MPG, rental mode) |
| 3 | Day 10 | Mid-trial value check-in |
| 4 | Day 21 | Annual deal — lock in pricing |
| 5 | Day 28 | Final 48 hours |

Users who upgrade are automatically skipped from further trial drip emails. Users with `emailOptOut=true` are excluded from all campaign emails.

---

## Gas Price Alert

**Plan:** Pro and Fleet  
**Component:** `GasPriceAlertBanner`  
**API:** `GET/PATCH /api/user/price-alert`

Users set a threshold price (e.g., $3.50/gal). When the national average drops below that threshold, a dismissable banner appears at the top of the app. Set in Settings → Gas Price Alert section.

---

## AI Fuel Advisor

**Plan:** Pro and Fleet  
**Component:** `AiAdvisor`  
**API:** `POST /api/ai`

Conversational chat interface powered by GPT-4o. Users can ask anything about fuel efficiency, upcoming trips, vehicle maintenance, cost estimates, etc. Context includes the user's recent fill-up history and saved vehicles.

---

## Trip Cost Estimator

**Plan:** Free (manual mode), Pro/Fleet (route-based with Google Maps)  
**Component:** `TripCostEstimator`, `GoogleMapsHandoffButton`, `WazeDeepLinkButton`  
**APIs:** `/api/maps/route`, `/api/maps/autocomplete`, `/api/maps/search-fuel-stops`

Two modes:

**Manual mode (Free):** Enter distance, vehicle MPG, and current gas price to see total gallons needed and estimated fuel cost. No account required.

**Route-based mode (Pro/Fleet):** Enter an origin and destination using address autocomplete. The Google Routes API calculates the actual route distance (not straight-line) and computes exact gallons needed and total fuel cost for that route.

- If refuel stops are needed, the app finds real gas stations along the route. A "Find Fuel Along the Way" button hands off to Google Maps or Waze with turn-by-turn directions to the nearest fuel stop.
- "Open Google Maps to Find Gas Nearby" is available for non-trip lookups.
- Both `GoogleMapsHandoffButton` and `WazeDeepLinkButton` are present side-by-side on the result card.
- Pro/Fleet users can save trips; saved trips appear in the Stats tab.
- After returning from Maps or Waze, the app auto-scrolls back to the trip result card.

---

## Station Comparison

**Plan:** Free  
**Component:** `StationComparison`

Compare two nearby stations: enter each price per gallon, quantity needed → see which is cheaper and by how much. Simple but useful at the pump.

---

## Streak Counter + Rewards

**Plan:** All signed-in users  
**Component:** `StreakCounter`, `StreakRewards`

Daily usage streak tracked via activity events. Shown at the top of the screen for signed-in users. Streak rewards (badges) at milestone day counts.

---

## Dark Mode

**Plan:** All users  
**Component:** `DarkModeProvider`

Three-way toggle: Auto (follows system sunrise/sunset), Light, Dark. Preference stored in localStorage. Applied via a CSS class on the `<html>` element.

---

## PWA / Offline

**Plan:** All users  
**Config:** `next.config.js` (withPWA), `public/manifest.json`

GasCap™ is installable as a Progressive Web App on iOS and Android via "Add to Home Screen." The core calculator works fully offline using the last-known gas price. Live gas price, AI features, and sync require an internet connection. Service worker is disabled in `development` mode — normal behavior.

---

## QR Placard Attribution

**Plan:** Internal / admin  
**Route:** `/q/[code]`  
**API:** `/api/campaigns`

Gas station QR placards embed a placement code (e.g., `SHELL-MAIN-ST-01`). Scanning sets a `gc_src` cookie. On signup, the cookie is read and the signup is attributed to the placement. Admin dashboard shows scans, signups, and conversion rates per placard.

---

## Desktop Two-Column Dashboard

**Plan:** All logged-in users (on desktop/lg screens)

At the `lg` breakpoint (1024px+), the main dashboard splits into two equal columns with a visual separator between them:

- **Left column:** calculator, streak counter, setup checklist, featured station
- **Right column:** vehicle garage, Tools & Insights panel, quick links

The right column is non-scrollable as an independent pane — it scrolls with the page. The single-column mobile layout is unchanged.
