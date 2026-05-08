# GasCap™ Partner Pilot Program

> **INTERNAL DOCUMENT — NOT FOR PUBLIC DISTRIBUTION**
> Strategy document for the "Know Before You Go" QR partner program.

---

## Overview

The GasCap™ Partner Pilot Program places QR code placards at physical fuel-adjacent locations — gas stations, c-stores, tire shops, auto service centers, rental car return zones — where drivers are actively thinking about fuel. When a driver scans a QR code, they land on GasCap™, run a calculation, and may register as an account attributed to that specific location.

This creates a two-sided value exchange:
- **Driver:** Gets a useful fuel-calculation tool at the exact moment they need it
- **Partner location:** Gets a measurable, attributed customer acquisition channel — a named user relationship they do not otherwise have

The program runs under the campaign name **"Know Before You Go."**

---

## Why This Matters Strategically

The partner pilot program serves three purposes that compound over time:

1. **Customer acquisition** — QR scans drive new user registrations. Each registration is attributed to a specific placement (station + location + placement type + headline variant).

2. **Data collection** — The campaign tracking system logs the full funnel: scan → app visit → calculation → account creation → return visit. This data shows which station types, which placement positions (counter vs. window vs. pump), and which headline variants convert best.

3. **Acquisition-value building** — A network of partner stations with per-station attribution data is commercially valuable to any buyer in the fuel/c-store space. A network of 50 stations with documented QR attribution → user → lifetime value data is a defensible asset that cannot be instantly replicated.

---

## Ideal Partner Types

| Partner Type | Why They're a Good Fit | Primary Value |
|---|---|---|
| **Independent Gas Stations** | Motivated to attract loyal customers; decision-maker is on-site | Named customer relationships |
| **Convenience Stores (C-Stores)** | High foot traffic; drivers already making in-store decisions | In-store habit formation |
| **Tire Shops** | Automotive service context; drivers think about vehicle performance | Maintenance reminder upsell |
| **Auto Service Centers** | Oil change timing aligns with GasCap™ maintenance reminders | Maintenance + MPG data |
| **Rental Car Return Areas** | Highest-intent moment for rental return calculator | Rental return mode usage data |
| **Hotel Driveways / Valet** | Traveling drivers frequently rent; high rental return relevance | Rental conversion |
| **Truck Stops / Travel Centers** | Heavy users; high-volume, long-distance drivers | Fleet plan conversion |

---

## Benefits to Partner Locations

1. **Named customer relationship** — Every driver who scans and registers is a named user. The station knows they attracted that person.
2. **Milestone reward tiers** — As signups accumulate, stations earn milestone status:
   - None → Candidate → Partner (25 signups) → Gold Partner (100 signups) → Premium Partner (250 signups)
3. **Featured station placement** — Gold and Premium partners are surfaced to GasCap™ users near their location in the app (via the `featured` flag in the campaign placement system).
4. **Reporting** — Partner stations can request a monthly report of their QR metrics: scans, unique scanners, signups, return visits.
5. **No cost to the partner** — Placards are provided by GasCap™. No software purchase required. No integration needed.

---

## QR Tracking Architecture

Each physical placard gets a unique QR code that encodes a short redirect URL:

```
https://www.gascap.app/q/[CODE]
```

**Code format:** `<CITY3><NUM3><PLACEMENT1>` — e.g., `ORL001C` (Orlando, placement #1, Counter)

The redirect endpoint (`app/q/[code]/route.ts`) fires a `scan` event and redirects to the landing path (typically the homepage). Attribution cookies are set for 30 days.

**Events tracked per placement:**
- `scan` — QR code scanned (redirect hit)
- `page_view` — Landing page loaded after redirect
- `calc_start` — Calculator opened
- `calc_complete` — Calculator returned a result
- `save_to_phone` — PWA install accepted
- `lead_capture` — Email/phone captured
- `signup` — Full account created
- `return_visit` — Attribution cookie recognized on return visit

**Aggregations computed per placement:**
- Scan-to-visit rate
- Visit-to-calc rate
- Calc-to-complete rate
- Visit-to-signup rate
- Unique vs. total scans
- Language split (English / Spanish)

**Stored in:** PostgreSQL (CampaignPlacement model) for placements + `data/campaign-events.json` for events. TODO: migrate events to PostgreSQL before scaling.

---

## Tent Card / Placard Specifications

Three headline variants are tested:

| Variant Code | Headline | Appeal |
|---|---|---|
| A-KnowBefore | "Know Before You Go" | Problem-aware |
| B-DontGuess | "Don't Guess at the Pump" | Pain point |
| C-StretchBudget | "Stretch Your Gas Budget" | Savings-focused |

Placement types:
- **Counter** — at the register or checkout counter inside the store
- **Window** — window cling or poster at the entrance
- **Register** — near or on the point-of-sale terminal
- **Pump** — attached to the gas pump or pump island
- **Flyer** — handout card given to customers

See `docs/PLACARD_COPY_AND_SPECS.md` for design specifications.

---

## Location Scan Tracking (admin-level)

The admin campaigns dashboard (`app/admin/campaigns/page.tsx`) provides:
- Table of all placements with status (active/inactive), featured flag, contact info
- Per-placement funnel stats: scans, unique scans, page views, calc starts, calc completes, signups, return visits
- Group-by analysis: by station, by placement type, by headline variant, by city
- Time-series chart (daily scans/signups over 30 days)
- Milestone tier for each station

---

## Partner Reporting Concept

**Monthly partner station report (to be built):**

```
Partner Station Report — [Station Name] — [Month Year]

QR Placement: [Code] at [Location]

This Month:
  Scans:         XX
  App Visitors:  XX
  Calculations:  XX
  New Accounts:  XX
  Return Visits: XX

All-Time:
  Total Signups: XX  [Milestone tier: Partner / Gold / Premium]

Thank you for hosting GasCap™. Your partnership has helped XX drivers
know before they go.
```

The data for this report is already collected. The report generation route does not yet exist.

---

## Metrics That Define Program Success

| Metric | Target (per active placement per month) | Notes |
|---|---|---|
| Scans | ≥30 | Indicates placard visibility |
| Unique scans | ≥20 | Removes repeat curiosity scans |
| Calc-completion rate | ≥40% | Product quality signal |
| Signup rate (of visitors) | ≥10% | Campaign quality signal |
| Return visits | ≥3 | Indicates user value retention |

**Portfolio targets (all placements combined):**
- Active placements: [TODO: document current count from admin dashboard]
- Total signups attributed to placements: [TODO: query]
- Placements at Gold+ tier: [TODO: query]

---

## Partner Offer Structure

**What GasCap™ offers to partner stations:**

1. Free QR placard (tent card or window cling) for each placement location
2. Attributed user tracking — monthly metrics showing their station's performance
3. Featured placement in-app when milestone tiers are reached
4. GasCap™ branding on their location in app (optional)

**What partners provide:**

1. Permission to display the placard at their location
2. Station name, address, and contact info for the placement record
3. Optional: a contact for reporting and follow-up

**No money exchanges hands in the pilot phase.** This keeps the relationship simple and allows any station to participate without budget approval.

---

## Approach Script (Field Use)

> "Hi, I'm with GasCap™ — we're a free fuel calculator app that helps drivers know exactly how much gas to pump and what it'll cost before they pull up. We're placing these QR tent cards at local stations in [City]. Drivers scan it, run a quick calculation, and some create accounts — which we then track back to your location. When you hit 25 signups from your QR code, we mark you as a Partner station and surface your location inside the app to nearby users. There's no cost to you — I just need your okay to put a card on your counter [or: attach one to your pump / put one in your window]. Can I leave a couple here?"

---

## Case Study Template

When a station reaches Partner tier (25+ attributed signups), build a one-page case study:

```
Partner Case Study: [Station Name], [City], [State]

Placement: [Type] — QR tent card at [location inside station]
Campaign: Know Before You Go — Headline Variant [A/B/C]
Program Duration: [Date range]

Results:
  Total QR Scans:      XX
  Unique Visitors:     XX
  Accounts Created:    XX  (XX% conversion rate)
  Return Visits:       XX  (XX% of accounts returned)
  Milestone Status:    [Partner / Gold / Premium]

"[Quote from station owner/manager if available]"

What This Means:
  [Station Name] helped XX drivers know before they go. 
  Every account created is a named customer — a long-term relationship 
  the station didn't have before partnering with GasCap™.
```

---

## Next Steps

1. **Document current active placement count** — query the admin campaigns dashboard
2. **Identify the two or three most active placements** — build case studies
3. **Build the partner monthly report generation route** — `app/api/admin/partner-report/route.ts`
4. **Identify one or two fuel brand contacts for a formal pilot discussion**
5. **Before scaling** — migrate campaign events from JSON to PostgreSQL

---

*Internal strategic document. May 2026.*
