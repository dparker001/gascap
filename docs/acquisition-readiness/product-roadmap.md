# GasCap™ Product Roadmap

> **INTERNAL DOCUMENT — NOT FOR PUBLIC DISTRIBUTION**
> Feature statuses are verified from codebase audit (May 2026). All future features are targets, not commitments.

---

## Roadmap Philosophy

GasCap™'s product strategy follows three principles:

1. **Free features that drive habit** — The free tier must be genuinely useful to drive daily active use. A free user who calculates every fill-up is more valuable than one who signs up and churns.
2. **Pro features that are worth $2.99/month** — Pro must save the user more than its cost, or feel indispensable. The rental return calculator, AI advisor, and Smart Fill-Up Optimizer are the strongest examples.
3. **Partner features that make GasCap™ defensible** — The QR campaign network, station attribution system, and partner dashboard are what a buyer cannot easily replicate — they require time, physical relationships, and behavioral data.

---

## Phase 1: Adoption (Completed / In Progress)

> Goal: Establish GasCap™ as the go-to fuel calculator with a habit loop, paid tier, and early partner network.

| Feature | Plan | Business Value | Acquisition Value | Status | Priority | Notes |
|---|---|---|---|---|---|---|
| Target Fill Calculator | Free | Core retention | Medium | **Implemented** | Done | `lib/calculations.ts` |
| Budget Calculator | Free | Core retention | Medium | **Implemented** | Done | `lib/calculations.ts` |
| Interactive Tank Gauge | Free | UX differentiation | Medium | **Implemented** | Done | `components/FuelGauge.tsx` |
| Live Gas Price (EIA) | Free | Core value | High | **Implemented** | Done | `app/api/gas-price/route.ts` |
| EPA Vehicle Database | Free | Core value | Medium | **Implemented** | Done | `app/api/fueleconomy/route.ts` |
| PWA / Offline Mode | Free | Adoption | Medium | **Implemented** | Done | `next.config.js` with withPWA |
| Google Maps Handoff | Free | Navigation intent | Very High | **Implemented** | Done | `lib/googleMaps.ts` |
| Waze Handoff | Free | Navigation intent | High | **Implemented** | Done | `lib/waze.ts` |
| User Accounts / Auth | All | Retention | High | **Implemented** | Done | NextAuth + PostgreSQL |
| Saved Vehicles | Free/Pro/Fleet | Retention | High | **Implemented** | Done | Plan-gated: 1/3/∞ |
| Rental Car Return Mode | Pro | Revenue driver | Very High | **Implemented** | Done | Highlighted as top Pro feature |
| Fill-Up Logger | Free/Pro | Data collection | Very High | **Implemented** | Done | `lib/fillups.ts` |
| MPG Tracking & Charts | Pro | Retention | High | **Implemented** | Done | Computed from fill-ups |
| Receipt Photo Scan | Pro | UX | High | **Implemented** | Done | GPT-4o Vision |
| VIN Photo Scan | Pro | UX | Medium | **Implemented** | Done | AI-powered VIN decode |
| Manual Trip Estimator | Free | Trip use case | Medium | **Implemented** | Done | |
| Maintenance Reminders | Pro | Retention | Medium | **Implemented** | Done | `lib/maintenance.ts` |
| Badge / Streak System | All | Gamification | Low | **Implemented** | Done | |
| Monthly Giveaway | Pro/Fleet | Retention | Medium | **Implemented** | Done | `lib/giveaway.ts` |
| Referral Program | All | Growth | High | **Implemented** | Done | Free months + Pro-for-life |
| Field Ambassador Program | Select | Growth | High | **Implemented** | Done | `lib/ambassador.ts` |
| QR Campaign System | All | Partner data | Very High | **Implemented** | Done | `lib/campaigns.ts` + PostgreSQL |
| Stripe Billing | Pro/Fleet | Revenue | Critical | **Implemented** | Done | Monthly + annual |
| Email Drip Sequences | All | Conversion | High | **Implemented** | Done | 10-email system |
| GHL CRM Sync | All | Operations | Medium | **Implemented** | Done | `lib/ghl.ts` |
| OneSignal Push | All | Engagement | Medium | **Implemented** | Done | Price alerts, reminders |
| GA4 + Meta Pixel | All | Analytics | High | **Implemented** | Done | Named events |
| English / Spanish UI | All | Adoption | High | **Implemented** | Done | `lib/translations.ts` |
| Fleet Dashboard | Fleet | Revenue | High | **Implemented** | Done | `app/fleet/page.tsx` |
| Fleet Tax Report PDF | Fleet | Revenue | High | **Implemented** | Done | PDFKit |
| Bulk Vehicle Import | Fleet | Revenue | Medium | **Implemented** | Done | CSV |
| Smart Fill-Up Optimizer | Pro | Revenue driver | Very High | **Implemented** | Done | EIA weekly data + regression |
| Gas Price Drop Alerts | Pro | Retention | High | **Implemented** | Done | Push + banner |
| AI Fuel Advisor | Pro | Retention | High | **Implemented** | Done | Claude (Anthropic) |
| Route-Based Trip Planner | Pro | Revenue driver | Very High | **Implemented (env-gated)** | Activate | Needs GOOGLE_MAPS_API_KEY + flag in production |
| Fuel Stops Along Route | Pro | Revenue driver | Very High | **Implemented (env-gated)** | Activate | Same env gate |
| Multi-Driver Sub-Accounts | Fleet | Revenue | High | **Planned (coming soon)** | Next | Listed on upgrade page; not in codebase |

---

## Phase 2: Pro Intelligence (Target: Q3–Q4 2026)

> Goal: Deepen Pro/Fleet intelligence to justify subscription, increase data value, and build a moat against competitors.

| Feature | Plan | Business Value | Acquisition Value | Status | Priority | Notes |
|---|---|---|---|---|---|---|
| Fuel Intent Score | Pro/Fleet | Acquisition value | Very High | Planned | High | See high-value-feature-recommendations.md |
| Recommended Fuel Stop Window | Pro | User value | Very High | Planned | High | Time/price window for optimal fill-up |
| Cost-Per-Mile Tracking | Pro/Fleet | User value | High | Planned | High | $/mile by vehicle and month |
| GasCap™ Savings Report (monthly PDF) | Pro/Fleet | Revenue/retention | High | Planned | Medium | One-tap monthly savings summary |
| Additional Language Support | All | Adoption | Medium | Deferred | Decision gate: May 26–31 | pt-BR priority per deferred sprint |
| Weekly Fuel Report Email | Pro/Fleet | Retention | Medium | Deferred | Decision gate: May 26–31 | Sunday digest |
| Dashboard Accent Color | All | UX | Low | Deferred | Decision gate: May 26–31 | User-selectable theme |
| Gas Price Confidence Indicator | Free/Pro | User value | High | Planned | Medium | How reliable is the current price data? |
| Driver Habit Loop | Pro/Fleet | Data value | Very High | Planned | High | Repeated behavior patterns → proactive insight |
| Smart Upgrade Timing | Internal | Revenue | High | Planned | High | ML-informed upgrade prompt timing |
| Fuel Budget Forecast | Pro/Fleet | User value | High | Planned | Medium | Predict month-end spend from fill-up pace |

---

## Phase 3: Fleet / Partner Network (Target: 2027)

> Goal: Build the commercial network that creates a defensible moat — partner stations, API integrations, and an anonymized fuel-behavior dataset.

| Feature | Plan | Business Value | Acquisition Value | Status | Priority | Notes |
|---|---|---|---|---|---|---|
| Partner Dashboard (self-serve) | Partner | Partner value | Very High | Planned | High | Gas stations see their own QR metrics |
| API / Integration Layer | B2B | Partnership | Very High | Planned | High | Enable fleet platforms, fuel cards, rental apps to integrate |
| Anonymized Fuel Behavior Dataset | Strategic | Acquisition | Very High | Planned | High | Privacy-safe aggregate dataset for strategic buyers |
| Station Selection Behavior | Strategic | Acquisition | Very High | Planned | High | Calculation → station choice → navigation attribution |
| Fleet Fuel Cost Forecasting | Fleet | Revenue | High | Planned | High | Fleet-wide spend projection |
| Fleet Telematics Lite | Fleet | Revenue | High | Planned | Medium | Basic odometer-based tracking (no GPS) |
| Rental Company Integration | B2B | Revenue | Very High | Planned | Medium | API or SDK for rental app integration |
| Multi-Driver Sub-Accounts (full) | Fleet | Revenue | High | In progress | Next | Phase 1 is driver labels; Phase 2 is separate logins |
| Corporate Fleet SSO | Fleet | Revenue | Medium | Planned | Low | Enterprise identity for large fleet accounts |
| Fuel Card Integration | B2B | Revenue | High | Planned | Low | Auto-match fill-up logs to card transactions |

---

## Decision Gate: End-of-May 2026

Per MEMORY.md, the following decision will be made around May 26–31, 2026 based on trial→paid conversion data:

| Conversion Rate | Action |
|---|---|
| ≥10% trial → paid | Build all three deferred features (pt-BR, weekly email, accent color) |
| 5–9% trial → paid | Build pt-BR only (highest ROI for Orlando market) |
| <5% trial → paid | Defer all; focus on retention/onboarding improvements |

This decision gate should be resolved before committing to Phase 2 priorities.

---

## Feature Prioritization Framework

When evaluating new features, score them across five dimensions (1–5 each):

| Dimension | Description |
|---|---|
| **User Value** | How much does this improve the daily experience? |
| **Revenue Impact** | Does this drive upgrades, reduce churn, or unlock a new revenue source? |
| **Data Value** | Does this generate a behavioral signal that is valuable over time? |
| **Defensibility** | Is this hard to copy once established? |
| **Acquisition Value** | Does this make the product more attractive to a strategic buyer or partner? |

Features scoring 4+ on Acquisition Value and Defensibility should be prioritized regardless of revenue impact, as they build the long-term moat.

---

*Internal strategic document. May 2026.*
