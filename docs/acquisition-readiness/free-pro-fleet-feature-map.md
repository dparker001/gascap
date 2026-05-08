# GasCap™ Free / Pro / Fleet Feature Map

> **INTERNAL DOCUMENT — NOT FOR PUBLIC DISTRIBUTION**
> Based on codebase audit May 2026. See current-feature-audit.md for detailed scoring.

---

## Plan Overview

| Attribute | Free | Pro | Fleet |
|---|---|---|---|
| **Price** | $0/forever | $4.99/mo or $49/yr | $19.99/mo or $199/yr |
| **Trial** | N/A | 30-day free trial (all new signups) | 30-day free trial |
| **Saved Vehicles** | 1 | Up to 3 (verify: stripe.ts shows 5) | Unlimited |
| **Drivers** | 1 | 1 | Up to 10 |
| **Target Audience** | Casual drivers, occasional use | Regular commuters, road trippers, rental car users | Small business fleets, households with 3+ vehicles |

---

## Feature Access Table

| Feature | Free | Pro | Fleet | Notes |
|---|---|---|---|---|
| **Core Calculators** | | | | |
| Target Fill Calculator | ✓ | ✓ | ✓ | All users including guests |
| Budget Calculator | ✓ | ✓ | ✓ | All users including guests |
| Interactive Tank Gauge | ✓ | ✓ | ✓ | Draggable SVG arc |
| Rental Car Return Mode | — | ✓ | ✓ | Toggle on any calculator |
| **Gas Price Features** | | | | |
| Live Local Gas Price | ✓ | ✓ | ✓ | EIA + Nominatim geolocation |
| Daily Fuel Pulse | ✓ | ✓ | ✓ | |
| Gas Price History Chart | ✓ | ✓ | ✓ | |
| National Gas Price Chart | ✓ | ✓ | ✓ | |
| Smart Fill-Up Optimizer | — | ✓ | ✓ | Fill now / wait + dollar savings |
| Gas Price Drop Alerts | — | ✓ | ✓ | Push notification on threshold |
| Gas Price Prediction | — | ✓ | ✓ | Forward-looking trend |
| Station Comparison | — | ✓ | ✓ | |
| **Vehicle Garage** | | | | |
| Save Vehicles | 1 | 3 (verify) | Unlimited | |
| EPA Database Search | ✓ | ✓ | ✓ | Tank size + MPG lookup |
| VIN Lookup | — | ✓ | ✓ | Vehicle specs by VIN |
| VIN Photo Scan | — | ✓ | ✓ | Camera/photo → VIN decode |
| Vehicle Silhouettes | ✓ | ✓ | ✓ | |
| Vehicle Comparison | — | ✓ | ✓ | |
| Garage Door (animated, session) | — | ✓ | ✓ | Stays open for tab session |
| Vehicle Spending Breakdown | — | — | ✓ | Per-vehicle spend |
| **Fill-Up Logging** | | | | |
| Log a Fill-Up | ✓ | ✓ | ✓ | Manual entry |
| Fill-Up History (filtered) | — | ✓ | ✓ | Month grouping, filters |
| MPG Calculation & Chart | — | ✓ | ✓ | From consecutive odometer readings |
| MPG Insight Card / Drop Alerts | — | ✓ | ✓ | Maintenance signal |
| Receipt Photo Scan | — | ✓ | ✓ | AI extracts gallons/price/date |
| Fill-Up CSV Export | — | ✓ | ✓ | |
| Driver Attribution on Fill-Ups | — | — | ✓ | driverLabel field |
| Driver Filter in History | — | — | ✓ | |
| **Budget & Savings** | | | | |
| Monthly Budget Goal | — | ✓ | ✓ | Fuel spend target + progress |
| Savings Dashboard | — | ✓ | ✓ | Month-over-month comparisons |
| Monthly Report Card | — | ✓ | ✓ | |
| Worst Fill-Up Widget | — | ✓ | ✓ | |
| **Trip Planning** | | | | |
| Manual Trip Estimator | ✓ | ✓ | ✓ | Distance + MPG → cost |
| Route-Based Trip Planner | — | ✓ | ✓ | Google Routes API (env-gated) |
| Fuel Stops Along Route | — | ✓ | ✓ | Google Places API (env-gated) |
| Save Trips | — | ✓ | ✓ | |
| **Navigation Handoffs** | | | | |
| Google Maps Handoff | ✓ | ✓ | ✓ | Privacy-safe URLs |
| Waze Handoff | ✓ | ✓ | ✓ | Privacy-safe URLs |
| **AI Features** | | | | |
| AI Fuel Advisor — Suggested Prompts | ✓ | ✓ | ✓ | 6 pre-set questions, free for all |
| AI Fuel Advisor — Custom Questions | — | ✓ | ✓ | Open-ended, Pro/Fleet only |
| **Maintenance** | | | | |
| Maintenance Reminders | — | ✓ | ✓ | Oil change, rotation, service |
| Vehicle Health Alert (MPG drop) | — | ✓ | ✓ | |
| **Fleet (Fleet Plan Only)** | | | | |
| Fleet Dashboard | — | — | ✓ | |
| Driver Management | — | — | ✓ | Up to 10 drivers |
| Bulk Vehicle Import (CSV) | — | — | ✓ | |
| Annual Tax Report PDF | — | — | ✓ | Tax-ready, brand-customizable |
| Fleet Branding (company logo) | — | — | ✓ | On PDF report |
| Multi-Driver Sub-Accounts | — | — | Coming soon | Not yet implemented |
| **Engagement & Rewards** | | | | |
| Badge System | ✓ | ✓ | ✓ | 12+ badges |
| Streak Counter | ✓ | ✓ | ✓ | Daily login streak |
| Monthly Giveaway (eligibility) | — | ✓ | ✓ | $25 Visa prepaid card |
| Referral Program | ✓ | ✓ | ✓ | All users get a referral code |
| Earn Free Pro Months | — | ✓ | ✓ | 1 free month per paying referral |
| **PWA / Offline** | | | | |
| Works Offline | ✓ | ✓ | ✓ | Service Worker + Workbox |
| Installable (Add to Home Screen) | ✓ | ✓ | ✓ | PWA manifest |

---

## Feature Gating Implementation

Feature gating is implemented through a combination of:

1. **`lib/featureAccess.ts`** — Centralized feature-key → allowed-plans mapping. Currently covers: `google_maps_handoff`, `waze_handoff`, `manual_trip_estimate`, `route_based_trip_planner`, `fuel_stops_along_route`, `save_trip`, `fleet_trip_planning`, `fleet_driver_route_planning`, `garage_door`. Function: `canAccessFeature(feature, plan)`.

2. **Plan checks in API routes** — Most API routes check `session.user.plan` directly or call `findById` to get the live plan. Example: `/api/ai/chat` checks if the question is a pre-approved suggested prompt (free) or custom (Pro required).

3. **Plan checks in components** — Components read `session.user.plan` and conditionally render Pro/Fleet content or show upgrade prompts.

4. **Trial override** — `isProTrial: true` on the User model grants Pro-level access during the 30-day trial period.

5. **Ambassador override** — `ambassadorProForLife: true` grants permanent Pro access without a Stripe subscription.

### TODO: Feature Gating Gaps
- Not all features use `lib/featureAccess.ts` — many components inline plan string comparisons. Consider consolidating to the centralized helper.
- Missing feature keys in `featureAccess.ts`: receipt scan, AI advisor custom questions, maintenance reminders, MPG charts, fill-up history, budget tracker, price alerts, fill-up optimizer. These should be added for consistent gating.
- Locked-feature UI: when a Free user hits a Pro feature, the upgrade prompt language is in `UPGRADE_COPY` in `featureAccess.ts`, but not all Pro feature gates use this copy consistently.

---

## Locked Feature Behavior (Current Implementation)

When a Free user encounters a Pro-only feature, the current behavior varies by feature:

| Feature | Current Locked Behavior | Recommended Improvement |
|---|---|---|
| Route-Based Trip Planner | Shows upgrade nudge / redirects to /upgrade | Add locked-feature GA4 event before redirect |
| Fuel Stops Along Route | Shows upgrade nudge | Same |
| AI Custom Questions | Returns 403 with "Upgrade to Pro" message | Consider showing the prompt field but blocking submission with an upgrade modal |
| Save Trip | Gated in component | Add analytics event |
| Garage Door | Hidden for free users | Add "unlock with Pro" teaser |
| Fill-Up History | Basic list for free; full history Pro | The boundary is implicit — make it explicit with an upgrade CTA in the list |
| Receipt Scan | Pro-only button hidden | Show grayed-out button with lock icon + upgrade CTA |
| Smart Fill-Up Optimizer | Pro-only — hidden | Same as receipt scan |
| MPG Charts | Pro-only | Show teaser chart with blur + upgrade CTA |

---

## Upgrade Prompt Strategy

### High-Conversion Upgrade Moments (by feature proximity to purchase intent)
1. **Rental Car Return Mode** — Every rental return calculation shows "Save $30–$80 on this rental with Pro." Users are at maximum cost-sensitivity at this moment.
2. **Smart Fill-Up Optimizer** — "You could save $X this week if you wait to fill up." Dollar savings are concrete.
3. **Gas Price Drop Alerts** — "Get notified when your state average drops below $X/gal." Threshold-based triggers.
4. **Route-Based Trip Planner** — "Plan a road trip: see your exact fuel cost and find gas along the way."
5. **MPG Trending Charts** — "See your actual fuel efficiency over time — catch engine issues before they cost you."

### Analytics Events to Fire on Upgrade Prompt Exposure
The following GA4 events should fire when a Free user encounters a locked Pro feature. These events are currently only partially implemented.

| Event Name | Trigger | Properties |
|---|---|---|
| `locked_feature_shown` | Free user sees a Pro feature gate | `feature_key`, `source_page` |
| `upgrade_prompt_clicked` | User clicks an upgrade CTA | `feature_key`, `source_page`, `cta_text` |
| `upgrade_page_viewed` | User lands on /upgrade | `referrer`, `billing_toggle` |
| `upgrade_initiated` | User clicks "Upgrade to Pro" button | `tier`, `billing_interval` |
| `upgrade_completed` | Stripe checkout success | `tier`, `billing_interval`, `amount` |

---

## Plan-Change Behavior

| Scenario | What Happens |
|---|---|
| Free → Pro (Stripe) | `plan` updated to `pro`. GHL tag updated. Stripe webhook fires P1 email. |
| Free → Fleet (Stripe) | `plan` updated to `fleet`. GHL tag updated. Stripe webhook fires P1 email. |
| Trial → Free (expired) | `isProTrial` set to false, `plan` remains `free`. Trial-expire cron runs daily. Trial-ended email fires. |
| Trial → Pro/Fleet (upgrade) | `isProTrial` cleared. Stripe subscription created. Earns early-upgrade giveaway bonus (+10 entries/month). |
| Pro → Free (cancel) | Stripe sends `subscription.deleted`. Webhook sets `plan=free`. P5 win-back email fires. |
| Pro → Fleet (upgrade) | Stripe handles plan change. GHL tag updated. |
| Fleet → Pro (downgrade) | Stripe handles. GHL tag updated. |

---

*Internal strategic document. May 2026.*
