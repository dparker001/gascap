# GasCap™ Buyer Feature Fit Matrix

> **INTERNAL DOCUMENT — NOT FOR PUBLIC DISTRIBUTION**
> Scores are 1 (low fit) → 5 (very high fit). Defensibility and buy-vs-build ratings are honest assessments.

---

## Buyer Type Legend

| Buyer Type | Abbreviation |
|---|---|
| Mapping / Navigation (Google Maps, Waze, Apple Maps, HERE) | **NAV** |
| Fuel / C-Store Chains (Circle K, Pilot, Casey's, Wawa) | **FUEL** |
| Rental Car Companies (Enterprise, Hertz, Avis, Sixt) | **RENTAL** |
| Fleet / Logistics Platforms (Samsara, Fleetio, Geotab) | **FLEET** |
| Fuel Card / Expense Platforms (WEX, FleetCor, Brex, Concur) | **FCARD** |
| Auto / Insurance / Telematics | **AUTO** |

---

## Feature Matrix

| Feature | NAV | FUEL | RENTAL | FLEET | FCARD | AUTO | Defensibility | Buy-vs-Build | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **Core Calculators** | | | | | | | | | |
| Target Fill Calculator | 3 | 5 | 4 | 4 | 3 | 2 | 2 | 2 | Calculator math is simple; value is user base and context |
| Budget Calculator | 2 | 5 | 3 | 5 | 5 | 2 | 2 | 2 | High for fleet and fuel retailers |
| Interactive Tank Gauge | 3 | 4 | 3 | 3 | 2 | 2 | 3 | 3 | UX differentiator; not hard to replicate |
| **Rental Car Return Mode** | | | | | | | | | |
| Rental Return Calculator | 2 | 3 | 5 | 2 | 2 | 2 | 4 | 4 | Purpose-built for the rental moment. Rental companies would love this or want to kill it. |
| Rental Savings Display | 2 | 2 | 5 | 2 | 2 | 1 | 3 | 4 | "You save $47 vs. Hertz refueling" — rental company would rather own this than have it public |
| **Gas Price Intelligence** | | | | | | | | | |
| Live Gas Price (EIA) | 5 | 5 | 3 | 4 | 4 | 2 | 2 | 2 | EIA is public; anyone can build this. Value is in the integration with the calculator. |
| Smart Fill-Up Optimizer | 5 | 5 | 3 | 4 | 4 | 2 | 4 | 4 | EIA trend + regression + personalization = hard to replicate without usage history |
| Gas Price Drop Alerts | 4 | 5 | 2 | 4 | 4 | 1 | 3 | 3 | Push + threshold — useful but buildable |
| Gas Price Prediction | 4 | 5 | 2 | 4 | 4 | 1 | 3 | 3 | Forward-looking trend from EIA data |
| **Navigation Handoffs** | | | | | | | | | |
| Google Maps Deep Link | 5 | 4 | 4 | 4 | 3 | 2 | 3 | 4 | For NAV: the handoff is the key data signal. Volume of qualified handoffs is what matters. |
| Waze Deep Link | 5 | 4 | 4 | 4 | 3 | 2 | 3 | 4 | Same as Google Maps handoff |
| Pre-Navigation Fuel Calculation | 5 | 5 | 4 | 4 | 3 | 2 | 5 | 5 | **The core acquisition signal.** Calculation → navigation = fuel intent. No other product captures this. |
| Fuel Stop Selection Behavior | 5 | 5 | 3 | 4 | 3 | 2 | 5 | 5 | Which station a driver navigates to after calculating — extremely high value for NAV and FUEL |
| **Vehicle Intelligence** | | | | | | | | | |
| VIN Scan + Lookup | 3 | 3 | 5 | 5 | 4 | 5 | 3 | 3 | Rental: verify vehicle; Fleet: inventory management; Auto: vehicle condition context |
| EPA Database Search | 3 | 3 | 4 | 4 | 3 | 4 | 2 | 2 | Public database; buildable |
| Vehicle Saving (Garage) | 3 | 4 | 5 | 5 | 4 | 4 | 3 | 3 | Fleet and rental need multi-vehicle management |
| **Fill-Up Intelligence** | | | | | | | | | |
| Fill-Up Logger | 3 | 5 | 3 | 5 | 5 | 4 | 3 | 3 | FUEL: behavior data; FCARD: expense integration; FLEET: cost tracking |
| MPG Tracking & Charts | 4 | 4 | 3 | 5 | 4 | 5 | 4 | 4 | AUTO: vehicle health signal; FLEET: efficiency tracking |
| MPG Drop Detection | 5 | 4 | 3 | 5 | 4 | 5 | 4 | 4 | Early maintenance signal — valuable to AUTO/insurance; fleet operations |
| Receipt Photo Scan | 3 | 4 | 3 | 5 | 5 | 3 | 3 | 4 | FCARD/expense: automated receipt capture is their core use case |
| Station History | 3 | 5 | 3 | 4 | 4 | 3 | 5 | 5 | **Where did users actually fill up?** The historical record of station choices is high value for FUEL buyers |
| **Trip Planning** | | | | | | | | | |
| Route-Based Trip Planner | 5 | 4 | 5 | 5 | 4 | 3 | 4 | 4 | NAV: validation of route cost before Maps opens; RENTAL/FLEET: trip approval workflows |
| Fuel Stops Along Route | 5 | 5 | 5 | 5 | 3 | 3 | 4 | 5 | Who selects which fuel stop on a route? Highly valuable behavioral signal. |
| Saved Trips | 3 | 3 | 3 | 5 | 4 | 3 | 2 | 2 | FLEET: recurring routes |
| **AI Features** | | | | | | | | | |
| AI Fuel Advisor | 4 | 4 | 3 | 5 | 4 | 3 | 3 | 3 | Differentiated UX; Claude integration; topic data reveals what users care about |
| AI Receipt Scan | 2 | 3 | 3 | 5 | 5 | 3 | 3 | 4 | FCARD/expense: automated capture is core to their product |
| **Partner / Campaign** | | | | | | | | | |
| QR Campaign Tracking | 2 | 5 | 3 | 3 | 3 | 2 | 5 | 5 | FUEL: the attribution system is a new customer acquisition channel for gas stations |
| Campaign Placement Network | 2 | 5 | 4 | 3 | 3 | 2 | 5 | 5 | Physical partner network takes time to build — cannot be replicated quickly |
| Featured Station (in-app) | 2 | 5 | 2 | 2 | 2 | 1 | 5 | 5 | FUEL: placement in a fuel calculator is commercial media — valuable when at scale |
| Milestone Tier System | 1 | 5 | 2 | 2 | 2 | 1 | 4 | 4 | Reward structure for partner engagement |
| **Fleet Features** | | | | | | | | | |
| Fleet Dashboard | 2 | 3 | 3 | 5 | 5 | 4 | 3 | 3 | FLEET: direct product relevance |
| Annual Tax Report PDF | 2 | 2 | 3 | 5 | 5 | 3 | 3 | 4 | Tax-ready report is a pain point for SMB fleet operators |
| Bulk Vehicle Import | 2 | 2 | 4 | 5 | 5 | 4 | 2 | 2 | Fleet onboarding value |
| Driver Attribution | 2 | 2 | 5 | 5 | 5 | 4 | 3 | 3 | RENTAL: driver tracking; FLEET: cost allocation |
| **Engagement** | | | | | | | | | |
| Monthly Giveaway | 1 | 3 | 2 | 2 | 2 | 1 | 1 | 1 | Retention tool; low buyer interest |
| Referral Program | 2 | 3 | 2 | 3 | 2 | 1 | 2 | 2 | Standard feature |
| Badge/Streak System | 2 | 3 | 2 | 2 | 2 | 1 | 1 | 1 | Gamification; low buyer interest |
| **Data Assets (Aggregate)** | | | | | | | | | |
| Anonymized Fuel-Intent Dataset | 5 | 5 | 4 | 5 | 5 | 4 | 5 | 5 | The sum of all calculation behavior: timing, amount, price, vehicle type, state. Not yet packaged. |
| Anonymized Station Selection History | 5 | 5 | 3 | 4 | 4 | 3 | 5 | 5 | Which stations drivers choose after calculating — extremely high value for FUEL/NAV |
| Anonymized MPG Trend Dataset | 4 | 3 | 3 | 5 | 4 | 5 | 5 | 5 | Real-world MPG by vehicle type/year — valuable for AUTO/insurance/telematics |

---

## Honest Assessment: What's Easy to Copy

The following features are straightforward to replicate by a well-resourced buyer:

| Feature | Why Easy to Copy | How to Make It Harder |
|---|---|---|
| Target Fill / Budget calculators | Pure math — 2-3 days to rebuild | The calculator itself is not the moat. The user base, behavioral history, and integration depth are. |
| Gas price lookup (EIA) | Public API | Not a moat — a baseline capability |
| Google Maps / Waze deep links | Public URL schemes | Not a moat — a UX pattern |
| Badge/streak system | Standard gamification | Not meant to be a moat |
| Manual trip estimator | Simple distance × MPG math | Not a moat |

**What is genuinely hard to copy quickly:**

| Feature | Why Hard to Copy |
|---|---|
| QR partner placement network | Requires time, physical relationships, and a track record with real stations. A buyer cannot buy a network instantly — it must be grown. |
| Station selection behavior history | The dataset of which stations users navigate to after calculating builds over time; cannot be synthesized. |
| Behavioral fill-up history | Users who have logged 50+ fill-ups have built a profile that cannot be reconstructed. The moat is the existing data, not the feature. |
| Smart Fill-Up Optimizer accuracy | Gets better with more state-level usage data. Early movers have richer training data. |
| Referral/ambassador network | The comp ambassador network (Pro-for-life in exchange for referrals) is a motivated human distribution channel. |
| Trial → paid conversion sequence | The 10-email sequence + engagement track is tested and live. The conversion learnings are the moat, not the emails themselves. |

---

## Priority Recommendations by Buyer Type

### If approaching NAV (mapping/navigation buyer):
Focus on: pre-navigation fuel calculation volume, station selection behavior, handoff rate, privacy-safe data architecture

### If approaching FUEL (gas station chain):
Focus on: QR campaign network depth, per-station attribution metrics, featured station concept, partner milestone tiers, trial case studies

### If approaching RENTAL (rental car company):
Focus on: rental return mode usage, average savings per calculation, geographic concentration near airports/hotel zones, potential integration path

### If approaching FLEET (fleet management platform):
Focus on: Fleet subscriber count, fill-ups logged per vehicle, tax report downloads, driver attribution, MPG drop detection, cost-per-vehicle reporting

### If approaching FCARD (fuel card/expense):
Focus on: fill-up log volume, receipt scan accuracy and usage rate, CSV export, potential API integration path

---

*Internal strategic document. May 2026.*
