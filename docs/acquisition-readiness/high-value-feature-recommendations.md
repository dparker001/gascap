# GasCap™ High-Value Feature Recommendations

> **INTERNAL DOCUMENT — NOT FOR PUBLIC DISTRIBUTION**
> Recommended features to increase acquisition value, defensibility, and buyer attractiveness. All are currently unimplemented unless noted.

---

## Framework: What Makes a Feature Acquisition-Valuable?

A feature is acquisition-valuable when at least two of the following are true:
1. It generates behavioral data that compounds over time
2. It creates a moat that is hard to replicate without an established user base
3. It directly addresses a buyer's strategic gap
4. It is uniquely positioned at the moment of fuel intent — before the pump decision

---

## Must-Have: Acquisition-Value Features

### 1. Fuel Intent Score

**Description:** A composite score (0–100) computed per user per calculation session that estimates the probability of a near-term fuel purchase. Inputs: current fuel level, price per gallon vs. recent average, time of day, day of week, days since last fill-up, vehicle range vs. nearest refuel point.

| Dimension | Rating |
|---|---|
| Buyer Value | Very High — this is the core signal NAV and FUEL buyers want |
| User Value | Medium — users don't need to see the score itself |
| Revenue Value | Medium — enables smarter upgrade prompts |
| Data Value | Very High — each calculation enriches the score model |
| Defensibility | Very High — requires extensive historical data to calibrate |
| Complexity | Medium |
| Plan Level | Internal (used for analytics + smart features) |

**Dependencies:** Existing calculation data + fill-up log history + Smart Fill-Up Optimizer data
**Privacy:** Score is internal — never shared with external parties in user-identifiable form
**Why Hard to Copy:** Score accuracy improves with usage data volume. An early-mover advantage compounds with each month of data.
**Priority:** High — begin with a rule-based approximation before ML

---

### 2. Pre-Navigation Calculation Signal (Calculation → Handoff Attribution)

**Description:** Track and report the rate at which users complete a fuel calculation and then open Google Maps or Waze within the same session. This is the key behavioral signal: proof that GasCap™ captures fuel intent before navigation begins.

| Dimension | Rating |
|---|---|
| Buyer Value | Very High — this is exactly what mapping/navigation buyers want to see |
| User Value | Low — user doesn't experience this directly |
| Revenue Value | Low — primarily a strategic asset |
| Data Value | Very High — proves the pre-navigation intent moment |
| Defensibility | Very High — no other product can provide this measurement |
| Complexity | Low — event tracking + attribution window |
| Plan Level | Analytics / reporting (internal and buyer-facing) |

**Implementation:** Add `pre_navigation_calculation` GA4 event when a Maps/Waze handoff occurs within a session where a calculation was completed. Track: session ID, calc_type, nav_app, user_plan, time_delta (seconds from calc to handoff).
**Privacy:** No PII. Session-level attribution only.
**Priority:** High — this is a measurement gap that is easy to close

---

### 3. Recommended Fuel Stop Window (Time + Price Intelligence)

**Description:** Based on the user's vehicle, fill-up history, typical usage pattern, and the Smart Fill-Up Optimizer, proactively surface: "Based on your driving pace, you'll likely need fuel in 2–3 days. State prices are projected to drop $0.04/gal by then — you could save approximately $X by waiting."

| Dimension | Rating |
|---|---|
| Buyer Value | High — proactive recommendations are a stickier product |
| User Value | Very High — actionable, personalized, dollar-specific |
| Revenue Value | High — drives daily opens, upgrade trigger |
| Data Value | High — uses fill-up cadence + price projection |
| Defensibility | High — requires fill-up history + price trend data |
| Complexity | Medium |
| Plan Level | Pro / Fleet |

**Dependencies:** Fill-up history (2+ records), Smart Fill-Up Optimizer (already implemented), push notification system
**Privacy:** Push notification content should not include location; use state-level context only
**Why Hard to Copy:** Requires real fill-up history per user — cannot be built without an existing engaged user base
**Priority:** High

---

### 4. Station Selection Behavior Tracking

**Description:** When a user completes a calculation and opens Maps or Waze, record the pre-navigation context anonymously. When the same user logs a fill-up within 2 hours with a station name, create an anonymous attribution record: [calculation session] → [navigation handoff] → [fill-up at station].

| Dimension | Rating |
|---|---|
| Buyer Value | Very High — this is the holy grail for fuel retailers and navigation platforms |
| User Value | Low — user doesn't experience this directly |
| Revenue Value | Low — strategic asset |
| Data Value | Very High — closes the intent → purchase loop |
| Defensibility | Very High — requires both calculation and fill-up history |
| Complexity | Medium |
| Plan Level | Analytics (internal) |

**Privacy:** All records must be anonymous. Station name from fill-up log is user-entered text — must be normalized/categorized before aggregation. No user ID in any external report.
**Priority:** High — but requires privacy review before any external sharing

---

### 5. Anonymized Fuel Behavior Dataset

**Description:** Package aggregate, anonymized, non-user-identifiable behavioral data into a reportable format:
- Calculation volume by state, by day of week, by time of day
- Average gallons needed at calculation time (bucketed)
- Price sensitivity signals: how many calculations precede a fill-up at below-average prices vs. above-average
- Vehicle type distribution (compact / sedan / SUV / truck / minivan)
- Smart Optimizer recommendation distribution: fill_now vs. wait vs. neutral by state/week

| Dimension | Rating |
|---|---|
| Buyer Value | Very High — this is the product a strategic buyer is really buying |
| User Value | None directly |
| Revenue Value | Low currently; High at scale (data licensing) |
| Data Value | Very High |
| Defensibility | Very High — data volume compounds over time |
| Complexity | Low to build; requires privacy review |
| Plan Level | Strategic asset |

**Privacy:** All data must be aggregate with minimum population thresholds (e.g., no state with <30 users). No user IDs, emails, VINs, or exact locations. Legal review required before sharing with any external party.
**Priority:** High — begin building the reporting infrastructure now even if not shared externally yet

---

## Strong Pro/Fleet Monetization Features

### 6. GasCap™ Savings Report (Monthly PDF, Pro/Fleet)

**Description:** One-tap monthly PDF showing: total gallons pumped, total spent on fuel, vs. prior month, estimated savings from optimal fill-up timing, worst fill-up of the month, best price captured, average MPG trend. Branded with GasCap™ for consumers; fleet company logo for Fleet plan.

| Dimension | Rating |
|---|---|
| Buyer Value | Medium |
| User Value | High — concrete value demonstration |
| Revenue Value | High — "my report says I saved $38 this month" = paid subscription justified |
| Data Value | Medium |
| Defensibility | Medium |
| Complexity | Low (PDF already exists for fleet; adapt for Pro) |
| Plan Level | Pro / Fleet |

**Priority:** Medium-High

---

### 7. Smart Upgrade Timing

**Description:** Instead of static upgrade nudges, time upgrade prompts to the moment of highest user motivation: immediately after a rental return calculation that shows $50+ savings, immediately after an MPG drop alert fires, immediately after the Smart Optimizer shows a significant savings window.

| Dimension | Rating |
|---|---|
| Buyer Value | Low |
| User Value | Medium (feels helpful, not pushy) |
| Revenue Value | Very High — conversion rate improvement |
| Data Value | Low |
| Defensibility | Low |
| Complexity | Low — timing change to existing nudge logic |
| Plan Level | Internal (Free → Pro conversion) |

**Priority:** High (high ROI, low complexity)

---

### 8. Fuel Price Confidence Indicator

**Description:** Show users how recent and reliable the current EIA price is. Example: "Price from 3 days ago — likely still accurate" vs. "Price data may be delayed — fill-up prices may vary." If price is older than 7 days, show a yellow flag and prompt gas price lookup.

| Dimension | Rating |
|---|---|
| Buyer Value | Low |
| User Value | High — reduces distrust when prices feel wrong |
| Revenue Value | Low |
| Data Value | Low |
| Defensibility | Low |
| Complexity | Low |
| Plan Level | Free |

**Priority:** Medium

---

## Partner Network Features

### 9. GasCap™ Partner Dashboard (Self-Serve)

**Description:** A portal where partner station operators can log in and see their own QR metrics: scans, unique scans, signups, return visits, milestone tier progress. No access to user data — only aggregate metrics attributed to their placement code.

| Dimension | Rating |
|---|---|
| Buyer Value | High — a buyer sees an existing commercial partner relationship |
| User Value | None (partner, not end-user) |
| Revenue Value | Medium — could become a paid feature for partners |
| Data Value | High — demonstrates the attribution system is real and working |
| Defensibility | High — requires existing partner relationships and placement network |
| Complexity | Medium |
| Plan Level | Partner (separate from consumer plans) |

**Privacy:** No user PII visible to partners — aggregate metrics only. Session IDs are opaque.
**Priority:** High — builds the commercial partner relationship into the product

---

### 10. Fleet Fuel Cost Forecasting

**Description:** For Fleet users, project next month's fuel cost based on: historical fill-up cadence per vehicle, price trend projection, and budgeted miles (optional input). Show variance from budget. Flag vehicles trending over budget.

| Dimension | Rating |
|---|---|
| Buyer Value | High — FLEET and FCARD buyers |
| User Value | Very High — this is the fleet manager's core planning need |
| Revenue Value | High — Fleet plan justification |
| Data Value | High — fleet behavioral patterns |
| Defensibility | Medium |
| Complexity | Medium |
| Plan Level | Fleet |

**Priority:** High for Fleet tier expansion

---

## Data and Analytics Features

### 11. Driver Habit Loop (Behavioral Pattern Intelligence)

**Description:** For users with 10+ fill-ups, detect and surface recurring patterns: "You typically fill up on Sundays between 8–10 AM. Next Sunday, the state average is projected at $X/gal." Delivered via push notification or in-app card.

| Dimension | Rating |
|---|---|
| Buyer Value | High — demonstrates behavioral data depth |
| User Value | High — feels intelligent and personal |
| Revenue Value | High — drives daily active use |
| Data Value | Very High — proves behavioral pattern detection |
| Defensibility | High — requires fill-up history volume |
| Complexity | Medium |
| Plan Level | Pro / Fleet |

**Priority:** Medium-High

---

## Strategic Integration Features

### 12. API / Integration Layer (B2B)

**Description:** A documented, key-authenticated API that allows B2B partners (fleet platforms, fuel cards, rental apps) to query GasCap™ data for their users (with user consent) or to embed calculation functionality in their own products.

| Dimension | Rating |
|---|---|
| Buyer Value | Very High — enables integration-based acquisition rationale |
| User Value | None directly |
| Revenue Value | High — B2B API licensing is a revenue model |
| Data Value | High — enables data-sharing partnerships |
| Defensibility | Medium |
| Complexity | High |
| Plan Level | B2B / Enterprise |

**Priority:** Medium — requires significant design work; build after core product is mature

---

## Privacy and Compliance Features

### 13. Cookie Consent Banner

**Description:** GDPR-compliant consent banner with accept/reject functionality. Blocks Meta Pixel and GA4 from firing until consent is granted (or does not require consent for analytics-only tracking under legitimate interest, depending on legal guidance).

| Dimension | Rating |
|---|---|
| Buyer Value | High — required for EU market; shows compliance maturity |
| User Value | Low directly; privacy-conscious users appreciate it |
| Revenue Value | Low |
| Data Value | Negative (blocks some analytics) |
| Defensibility | N/A |
| Complexity | Low to Medium |
| Plan Level | All (infrastructure) |

**Priority:** High — compliance gap that must be closed

---

### 14. Data Export Route (GDPR/CCPA)

**Description:** A `/api/user/export` route that generates a downloadable ZIP of all user data: account info, vehicles, fill-up logs, trip logs, email campaign status. This is a GDPR data portability requirement and a CCPA right-to-know requirement.

| Dimension | Rating |
|---|---|
| Buyer Value | High — required for any EU or California market |
| User Value | Medium — privacy-conscious users and those wanting to leave |
| Revenue Value | None |
| Data Value | N/A |
| Defensibility | N/A |
| Complexity | Low-Medium |
| Plan Level | All (compliance) |

**Priority:** High — compliance gap

---

## Features to Avoid or Deprioritize

| Feature | Reason to Avoid |
|---|---|
| **In-app fuel purchase / payment** | Would require PCI compliance overhaul; competes with gas station's own payment infrastructure; unlikely to be adopted by partners |
| **GPS vehicle tracking** | Privacy risk, regulatory complexity, hardware dependency; not aligned with the "know before you go" moment |
| **Gas station price database (crowdsourced)** | GasBuddy owns this space; competing directly would require massive data collection; not differentiated |
| **Car insurance integration** | Heavily regulated; requires explicit user consent; not a near-term opportunity |
| **Fuel delivery on demand** | Different business model; logistics complexity; not a SaaS play |
| **Advertising / banner ads** | Would undermine the premium brand; not worth the revenue for Pro/Fleet users |

---

*Internal strategic document. May 2026.*
