# GasCap™ Strategic Positioning

> **INTERNAL DOCUMENT — NOT FOR PUBLIC DISTRIBUTION**

---

## Core Positioning Statement

**GasCap™ is a fuel-intelligence platform, not a gas price app or a calculator.**

A gas price app tells you where prices are. A calculator tells you what something costs. GasCap™ does something fundamentally different: it captures, processes, and acts on a driver's fuel intent — the moment before they decide how much fuel to buy, where to buy it, and whether to navigate there.

> "GasCap™ sits between the moment a driver realizes they need fuel and the moment they choose where to navigate. It captures fuel intent before the driver reaches the pump."

That moment is commercially valuable. It is the moment that gas stations, convenience store chains, fleet operators, rental car companies, fuel card providers, and navigation platforms most want to influence — and it is the moment that consumer apps almost universally miss.

---

## What GasCap™ Does Today

As of May 2026, GasCap™ is a live, production PWA (Progressive Web App) with paying subscribers. Current capabilities:

### Core Fuel Intelligence
- **Target Fill Calculator** — given current fuel level (% or gallons) and target fill level, compute exact gallons needed and cost at the current local price
- **Budget Calculator** — given a dollar budget and current fuel level, compute gallons purchasable and resulting tank level
- **Interactive Tank Gauge** — draggable SVG arc gauge for setting current fuel level
- **EPA Vehicle Database** — search and auto-fill tank capacity from a database of real vehicle specs
- **Live Gas Price Lookup** — EIA government data API, localized to user's state via Nominatim reverse geocode
- **Daily Fuel Pulse** — daily gas price summary with national context
- **Price History** — state-level gas price trend charts
- **Smart Fill-Up Optimizer** — uses EIA weekly state data to recommend fill-up timing (fill now / wait / neutral) with projected dollar savings

### Navigation Handoffs (Implemented — Free for All Users)
- **Google Maps Handoff** — one-tap button opens Google Maps to search for nearby gas stations; for trip plans, opens directions to specific fuel stops
- **Waze Handoff** — one-tap button opens Waze with gas station search near the user's detected location
- **Privacy-safe URL construction** — user email, user ID, VIN, and vehicle name are never embedded in Maps or Waze URLs (documented in `lib/googleMaps.ts` and `lib/waze.ts`)

### User Intelligence (Pro/Fleet)
- **Fill-Up Logger** — manual entry of each pump visit: date, gallons, price/gal, odometer, station name, notes, driver label (Fleet)
- **MPG Tracking** — computed from consecutive fill-ups with same vehicle; chart over time
- **Fill-Up History** — browsable, filterable by month and driver; delete/edit
- **Receipt Photo Scan** — AI (GPT-4o Vision) extracts gallons, price, date from a gas receipt photo; pre-fills the form
- **Monthly Budget Tracker** — set a monthly fuel spend target; GasCap™ tracks against it with visual progress
- **VIN Photo Scan** — camera/photo upload to auto-decode VIN and populate vehicle specs
- **Savings Dashboard** — monthly savings vs. prior month, worst fill-up highlights
- **MPG Insight Card** — flags drops in fuel efficiency (potential maintenance signals)
- **Maintenance Reminders** — oil change, tire rotation, and service intervals by mileage

### Trip Planning (Pro/Fleet)
- **Manual Trip Estimator** — enter distance and MPG to estimate trip fuel cost
- **Route-Based Trip Planner** — enter origin and destination; Google Routes API computes actual route distance and fuel cost (requires GOOGLE_MAPS_API_KEY env var, gated behind feature flag)
- **Fuel Stops Along Route** — finds gas stations near the route midpoint (Google Places API); opens in Google Maps or Waze
- **Saved Trips** — save and recall trip plans

### Rental Car Return Mode (Implemented — Pro Feature Highlighted)
- Toggle on any calculator to switch to rental return mode
- Enter rental company's refuel rate (typically $10–$12/gallon)
- Calculator shows exact gallons to buy before drop-off and exact dollar savings vs. renting company refueling
- Marketed as the feature most likely to pay for a Pro subscription in a single trip

### Fleet Dashboard (Fleet Plan)
- Per-vehicle spending breakdown
- Driver attribution on fill-ups (driver label field)
- Driver management (add/remove drivers, limit of 10)
- Bulk vehicle import (CSV)
- CSV export for accounting
- Annual fuel cost PDF report (tax-ready, brand-customizable with company name and logo)

### User Accounts & Engagement
- Registration, login, email verification, password reset
- 30-day Pro trial for all new signups (no credit card required)
- Streak counter (consecutive daily logins)
- Badge achievement system (12+ badges)
- Monthly gas card giveaway ($25 Visa prepaid) — entries from daily activity + streak bonuses
- Referral program — earn free Pro months; ambassador tier (Pro for life) at 15 paying referrals
- Field Ambassador program with QR/placard tracking

### Analytics & CRM
- GA4 + Meta Pixel (both installed, both active)
- Named GA4 events: `calculate`, `gas_price_lookup`, `sign_up`, `upgrade_click`, `log_fillup`, `save_vehicle`, `referral_share`, `qr_scan`, `google_maps_open`
- GoHighLevel CRM sync on registration/upgrade/cancel (plan tags: `gascap-free`, `gascap-pro`, `gascap-fleet`)
- QR/campaign placement tracking (CampaignPlacement model in PostgreSQL) — full funnel: scan → page view → calc start → calc complete → save to phone → lead capture → signup → return visit
- OneSignal push notifications (price alerts, fill-up reminders, weekly digest)
- Email drip: 10-email sequence (D1-D5 trial, P1-P5 paid) + comp ambassador (C1-C5) + engagement track + verification reminder

### Localization
- English/Spanish bilingual UI (complete translation coverage via `lib/translations.ts`)
- Spanish-language QR tracking variants in campaign analytics
- GHL chat widget in English and Spanish

### PWA / Offline
- Installable as home screen app (manifest.json, PWA icons)
- Offline calculator functionality via Service Worker

---

## What GasCap™ Can Become

The current product is a strong foundation. The strategic direction is to move from consumer utility to fuel-intelligence data platform:

1. **Fuel intent signals at scale** — Every calculation is a structured data point: vehicle type, tank size, current fuel level, price sensitivity, geographic location (state), time of day, day of week. As this scales, it becomes an anonymized, privacy-safe behavioral dataset describing how drivers think about fuel — before they navigate.

2. **Station selection behavior** — When a user taps "Open in Google Maps" or "Open in Waze," GasCap™ knows the calculation context that preceded it: fuel level, budget, price comparison, route context. That link — calculation → navigation handoff — is the beginning of station selection behavior data.

3. **Partner location attribution** — The QR/campaign tracking system can attribute user signups and calculations to specific physical station locations. At scale, a partner station that drives 500 signups has measurable lift. That is the beginning of a performance marketing channel for fuel retailers.

4. **Fleet fuel cost intelligence** — Fleet operators currently use spreadsheets or expensive enterprise fleet management tools. GasCap™ Fleet provides per-vehicle spend tracking, tax reports, and driver attribution at a fraction of the cost of legacy tools.

5. **Rental return as a commercial signal** — The rental car return feature is used at or near rental drop-off locations, which are geographically concentrated (airport terminals, hotel zones, downtown locations). The calculation itself signals a commercial purchase intent: the user must buy fuel within the next 15–30 minutes at a specific station.

---

## Why Fuel-Intent Behavior Matters

**The fuel market in the US:**
- ~145 million licensed drivers
- ~$500B annually in retail fuel spend
- Gas stations and convenience stores spend billions on in-store marketing to influence the driver who is *already at the pump*
- Navigation platforms (Google Maps, Waze) route drivers to stations before the pump decision is made
- No company has effectively captured the moment *before navigation begins* — when the driver calculates how much fuel they need

**The GasCap™ insight:** A driver who knows they need exactly 8.2 gallons is a more qualified fuel buyer than a driver who just noticed their gauge is low. GasCap™ is the only consumer app that systematically captures this pre-pump calculation behavior.

---

## Value to Specific Buyer Types

### Mapping / Navigation Platforms
GasCap™'s free-for-all Google Maps and Waze handoff buttons already generate qualified navigation handoffs — users who have completed a fuel calculation (intent confirmed) and then tap to navigate. At scale, this is a structured feed of high-intent navigation requests with vehicle context. No personally identifiable information leaves the app.

### Gas Stations and Convenience Store Chains
The partner pilot program places GasCap™ QR placards at physical station locations. Drivers scan at or near the pump, calculate their fill-up, and convert to registered users attributed to that station. This creates a measurable acquisition channel for the station — a new customer relationship asset they do not currently have.

### Rental Car Companies
The rental return calculator is purpose-built for rental car return scenarios. A rental car company that licenses or co-brands this feature in their app would give customers a tool that also saves the company refueling dispute costs and improves the customer experience at a high-friction moment in the rental lifecycle.

### Fleet Operators
GasCap™ Fleet is an affordable alternative to expensive fleet management tools for small-to-medium fleets (1–50 vehicles). Tax-ready PDF reports, per-vehicle spending, driver attribution, and CSV export cover the primary financial use case without requiring an IT department.

### Fuel Card / Expense Platforms
Fuel card companies (WEX, Fleetcor, Comdata) process fuel transactions but have limited pre-transaction data. GasCap™'s fill-up log + MPG tracking + receipt scan creates a post-purchase fuel intelligence layer that complements transaction data with behavioral context.

---

## What GasCap™ Is Not (Important for Positioning)

- Not a gas price comparison app (no price database, no station inventory)
- Not a fleet management system (no GPS tracking, no vehicle telematics)
- Not a payment platform (no in-app fuel purchase)
- Not a navigation app (handoffs only — GasCap™ does not compete with Google Maps or Waze)

These are deliberate constraints. They mean GasCap™ is complementary to all of these, not competitive.

---

*Internal strategic document. May 2026.*
