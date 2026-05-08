# GasCap™ Current Feature Audit

> **INTERNAL DOCUMENT — NOT FOR PUBLIC DISTRIBUTION**
> All implementation statuses are based on codebase audit conducted May 2026. Scores are 1–5 (5 = highest).

---

## Scoring Key

| Dimension | Scale |
|---|---|
| **User Value** | 1 (marginal) → 5 (core daily driver) |
| **Business Value** | 1 (nice to have) → 5 (revenue-critical) |
| **Buyer Value** | 1 (replicable easily) → 5 (hard to replicate, strategically important) |
| **Data Value** | 1 (no signal) → 5 (rich behavioral dataset) |
| **Revenue Value** | 1 (no revenue link) → 5 (direct conversion driver) |
| **Retention Value** | 1 (one-time) → 5 (daily habit) |
| **Partner Value** | 1 (no partner relevance) → 5 (core partner tool) |
| **Defensibility** | 1 (copy in a week) → 5 (very hard to replicate) |
| **Buy-vs-Build** | 1 (build is trivial) → 5 (buying is strongly preferable) |

---

## Group 1: Core Fuel Calculation

| Feature | Location | Status | Plan | User | Biz | Buyer | Data | Rev | Ret | Partner | Def | BvB | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Target Fill Calculator | `lib/calculations.ts`, `components/TargetFillForm.tsx` | Implemented | Free | 5 | 4 | 3 | 3 | 4 | 5 | 3 | 2 | 2 | Core loop. Simple math but drives all other behavior |
| Budget Calculator | `lib/calculations.ts`, `components/BudgetForm.tsx` | Implemented | Free | 5 | 4 | 3 | 3 | 4 | 5 | 3 | 2 | 2 | Complements target fill |
| Interactive Tank Gauge (SVG) | `components/FuelGauge.tsx` | Implemented | Free | 5 | 3 | 3 | 2 | 3 | 5 | 2 | 3 | 3 | Draggable SVG arc. Unique UX. Geometry is documented in MEMORY.md |
| Tank Size Presets | `lib/calculations.ts` (VEHICLE_PRESETS) | Implemented | Free | 4 | 2 | 1 | 1 | 2 | 3 | 1 | 1 | 1 | 8 vehicle type presets; bypassed when vehicle is saved |
| Validation & Error Handling | `lib/calculations.ts` | Implemented | Free | 4 | 3 | 2 | 1 | 2 | 3 | 1 | 2 | 2 | Input validation with domain-aware error messages |

---

## Group 2: Rental Car Return Mode

| Feature | Location | Status | Plan | User | Biz | Buyer | Data | Rev | Ret | Partner | Def | BvB | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Rental Return Toggle | `components/TargetFillForm.tsx` | Implemented | Pro (highlighted) | 5 | 5 | 5 | 4 | 5 | 4 | 4 | 4 | 4 | Highly differentiated. Used at high-intent commercial moment. Paid for by a single trip. |
| Rental Company Rate Input | `components/TargetFillForm.tsx` | Implemented | Pro | 5 | 4 | 4 | 3 | 4 | 3 | 4 | 3 | 3 | User enters rental co refuel rate. No integration with rental companies yet. |
| Rental Savings Calculation | `lib/calculations.ts` | Implemented | Pro | 5 | 5 | 5 | 4 | 5 | 4 | 5 | 4 | 4 | Shows exact dollar savings vs. rental company refueling. Compelling conversion driver. |

---

## Group 3: Trip Planning

| Feature | Location | Status | Plan | User | Biz | Buyer | Data | Rev | Ret | Partner | Def | BvB | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Manual Trip Estimator | `components/TripCostEstimator.tsx` | Implemented | Free | 4 | 3 | 3 | 3 | 3 | 4 | 3 | 2 | 2 | Distance + MPG → fuel cost. No API required. |
| Route-Based Trip Planner | `app/api/maps/route/route.ts`, `lib/mapsProvider/` | Implemented (env-gated) | Pro | 5 | 5 | 5 | 4 | 5 | 5 | 4 | 4 | 4 | Google Routes API. Requires GOOGLE_MAPS_API_KEY + GOOGLE_MAPS_TRIP_PLANNER_ENABLED=true. Gated by env flag — not yet fully activated in production. |
| Fuel Stops Along Route | `app/api/maps/search-fuel-stops/route.ts` | Implemented (env-gated) | Pro | 5 | 5 | 5 | 4 | 5 | 5 | 5 | 4 | 4 | Google Places API. Finds gas stations near route midpoints. Same env gate as route planner. |
| Trip Fuel Plan Math | `lib/tripFuelPlanner.ts` | Implemented | Pro | 5 | 4 | 4 | 3 | 4 | 4 | 4 | 3 | 3 | Pure math: gallons needed, recommended refuel window, range on current tank |
| Saved Trips | `lib/savedTrips.ts`, `components/SavedTrips.tsx` | Implemented | Pro | 4 | 3 | 3 | 3 | 3 | 4 | 3 | 2 | 2 | Save/recall trip plans |

---

## Group 4: Navigation Handoffs

| Feature | Location | Status | Plan | User | Biz | Buyer | Data | Rev | Ret | Partner | Def | BvB | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Google Maps Deep Link | `lib/googleMaps.ts`, `components/GoogleMapsHandoffButton.tsx` | Implemented | Free | 5 | 4 | 5 | 4 | 4 | 4 | 4 | 3 | 4 | Privacy-safe URL builder. GA4 event: `google_maps_open`. No PII in URLs. |
| Waze Deep Link | `lib/waze.ts`, `components/WazeDeepLinkButton.tsx` | Implemented | Free | 4 | 3 | 4 | 3 | 3 | 3 | 3 | 3 | 3 | Waze URL with coords, query, utm_source=gascap |
| Fuel Stop Selection Handoff | `app/api/maps/search-fuel-stops/route.ts` + handoff components | Implemented (env-gated) | Pro | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | Calculation context → station selection → navigation handoff. The key data signal for mapping buyers. |
| Maps Autocomplete | `app/api/maps/autocomplete/route.ts` | Implemented (env-gated) | Pro | 4 | 3 | 3 | 2 | 3 | 3 | 2 | 2 | 3 | Address autocomplete for trip origin/destination entry |

---

## Group 5: Saved User Features

| Feature | Location | Status | Plan | User | Biz | Buyer | Data | Rev | Ret | Partner | Def | BvB | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Vehicle Garage | `lib/savedVehicles.ts`, `components/SavedVehicles.tsx` | Implemented | Free(1), Pro(3/5), Fleet(∞) | 5 | 5 | 4 | 3 | 5 | 5 | 3 | 3 | 3 | Note: stripe.ts shows Pro allows 5 vehicles; upgrade page shows 3. Verify which is live. |
| VIN Lookup | `app/api/vin/route.ts` | Implemented | Pro | 4 | 4 | 3 | 3 | 4 | 4 | 2 | 2 | 2 | Looks up vehicle specs by VIN from external data source |
| VIN Photo Scan | `app/api/vin/scan/route.ts` | Implemented | Pro | 4 | 4 | 3 | 3 | 4 | 3 | 2 | 3 | 3 | Camera/photo upload → VIN decode via AI vision |
| EPA Vehicle Database Search | `app/api/fueleconomy/route.ts`, `app/api/mpg-lookup/route.ts` | Implemented | Free | 5 | 4 | 3 | 3 | 4 | 4 | 2 | 2 | 2 | EPA fuel economy data for tank sizes and MPG estimates |
| Maintenance Reminders | `lib/maintenance.ts`, `components/MaintenanceReminders.tsx` | Implemented | Pro | 4 | 3 | 3 | 3 | 3 | 4 | 2 | 2 | 2 | Oil change, tire rotation, service intervals by mileage |
| Vehicle Health Alerts | `components/VehicleHealthAlert.tsx` | Implemented | Pro | 4 | 3 | 3 | 3 | 3 | 4 | 2 | 2 | 2 | MPG-drop detection surfaced as a health alert |
| Vehicle Silhouettes | `lib/vehicleSilhouette.ts` | Implemented | Free | 3 | 2 | 1 | 1 | 1 | 2 | 1 | 1 | 1 | Visual vehicle type icons |
| Vehicle Comparison | `components/VehicleComparison.tsx` | Implemented | Pro | 3 | 3 | 2 | 2 | 2 | 3 | 2 | 2 | 2 | Side-by-side comparison of saved vehicles |
| Vehicle Spending Breakdown | `components/VehicleSpendingBreakdown.tsx` | Implemented | Fleet | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 3 | Per-vehicle fuel spend — key Fleet feature |
| Budget Goal | `lib/budgetGoals.ts`, `components/MonthlyBudgetGoal.tsx` | Implemented | Pro | 4 | 3 | 3 | 3 | 3 | 5 | 2 | 2 | 2 | Monthly fuel budget + progress tracking |
| Preferred Fill Level | `prisma/schema.prisma` (preferredFillLevel field) | Implemented | Pro | 3 | 2 | 2 | 2 | 2 | 3 | 2 | 2 | 2 | Default target fill % stored per user |

---

## Group 6: Fill-Up Logging & MPG Intelligence

| Feature | Location | Status | Plan | User | Biz | Buyer | Data | Rev | Ret | Partner | Def | BvB | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Fill-Up Logger | `lib/fillups.ts`, `components/FillupLogger.tsx`, `components/ManualFillupLogger.tsx` | Implemented | Free (log), Pro (history) | 5 | 5 | 4 | 5 | 5 | 5 | 3 | 4 | 4 | Core habit loop. Each logged fill-up is a behavioral data point. |
| Fill-Up History | `components/FillupHistory.tsx` | Implemented | Pro | 5 | 5 | 4 | 4 | 5 | 5 | 3 | 3 | 3 | Grouped by month, filterable. Fleet adds driver filter. |
| MPG Calculation | `lib/fillups.ts` (computeMpg) | Implemented | Pro | 5 | 5 | 5 | 5 | 5 | 5 | 4 | 3 | 4 | From consecutive fill-ups with odometer readings |
| MPG Chart | `components/MpgChart.tsx` | Implemented | Pro | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 2 | 3 | Visual MPG trend over time |
| MPG Insight Card | `components/MpgInsightCard.tsx` | Implemented | Pro | 4 | 4 | 4 | 5 | 4 | 5 | 4 | 3 | 4 | Flags MPG drops as potential maintenance signals |
| Receipt Photo Scan | `app/api/fillups/scan/route.ts` | Implemented | Pro | 5 | 5 | 4 | 4 | 5 | 4 | 3 | 3 | 3 | GPT-4o Vision extracts gallons, price, date from gas receipt photo |
| Fill-Up Export (CSV) | `app/api/fillups/export/route.ts`, `app/fillups/export/page.tsx` | Implemented | Pro | 4 | 3 | 4 | 2 | 3 | 3 | 3 | 2 | 2 | CSV export of fill-up history |
| Fill-Up PDF Export | `app/api/fleet/tax-report/route.ts` | Implemented | Fleet | 5 | 5 | 4 | 3 | 5 | 4 | 4 | 3 | 3 | Annual tax-ready PDF report for Fleet users |
| Average MPG API | `app/api/fillups/avg-mpg/route.ts` | Implemented | Pro | 3 | 3 | 3 | 3 | 3 | 3 | 2 | 2 | 2 | Exposes avg MPG to other app components |
| Station History | `app/api/fillups/stations/route.ts` | Implemented | Pro | 3 | 3 | 3 | 4 | 3 | 3 | 5 | 4 | 4 | Which stations a user has filled up at. High partner/buyer value if aggregated. |
| Fill-Up Validation | `lib/fillups.ts` (validateNewFillup) | Implemented | Pro | 4 | 4 | 3 | 3 | 3 | 3 | 2 | 3 | 3 | Domain-aware validation: duplicate date, odometer regression, implausible price |
| Worst Fill-Up Widget | `components/WorstFillup.tsx` | Implemented | Pro | 3 | 2 | 2 | 2 | 2 | 3 | 1 | 1 | 1 | Gamified: shows most expensive fill-up. Engagement hook. |

---

## Group 7: Gas Price Intelligence

| Feature | Location | Status | Plan | User | Biz | Buyer | Data | Rev | Ret | Partner | Def | BvB | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Live Gas Price Lookup | `app/api/gas-price/route.ts`, `components/GasPriceLookup.tsx` | Implemented | Free | 5 | 4 | 4 | 4 | 4 | 5 | 4 | 2 | 3 | EIA API + Nominatim geocoding. State-level price. |
| Gas Price History Chart | `app/api/gas-price/history/route.ts`, `components/FuelPriceHistory.tsx` | Implemented | Free | 4 | 3 | 3 | 4 | 3 | 4 | 3 | 2 | 2 | Historical price trend chart |
| National Gas Price Chart | `app/api/gas-price/national/route.ts`, `components/NationalGasPriceChart.tsx` | Implemented | Free | 3 | 2 | 2 | 3 | 2 | 3 | 2 | 1 | 1 | National context for local price |
| Daily Fuel Pulse | `app/api/gas-price/pulse/route.ts`, `components/DailyFuelPulse.tsx` | Implemented | Free | 4 | 3 | 3 | 3 | 3 | 4 | 3 | 2 | 2 | Daily price update with context |
| Smart Fill-Up Optimizer | `components/SmartFillUpOptimizer.tsx`, `app/api/fillup-optimizer/route.ts` | Implemented | Pro | 5 | 5 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | Uses EIA weekly state data + linear regression → fill now / wait / neutral + dollar savings estimate |
| Gas Price Drop Alerts | `app/api/cron/price-alerts/route.ts`, `app/api/user/price-alert/route.ts`, `components/GasPriceAlertBanner.tsx` | Implemented | Pro | 5 | 5 | 4 | 4 | 5 | 5 | 4 | 3 | 3 | User sets threshold; push notification when state average drops below it |
| Gas Price Prediction | `components/GasPricePrediction.tsx` | Implemented | Pro | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 3 | Forward-looking price projection (based on EIA trend data) |
| Station Comparison | `components/StationComparison.tsx` | Implemented | Pro | 4 | 3 | 4 | 4 | 3 | 3 | 5 | 3 | 4 | Compare gas prices at nearby stations |

---

## Group 8: AI / Intelligence Features

| Feature | Location | Status | Plan | User | Biz | Buyer | Data | Rev | Ret | Partner | Def | BvB | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AI Fuel Advisor (Chat) | `app/api/ai/chat/route.ts`, `components/AiAdvisor.tsx` | Implemented | Pro (custom) / Free (suggested prompts) | 5 | 5 | 5 | 4 | 5 | 5 | 3 | 4 | 4 | Claude-powered. Has user vehicle context, fill-up history, budget goal. Suggested questions free; custom questions Pro/Fleet only. |
| Engagement Nudge | `app/api/nudge/route.ts`, `components/EngagementNudge.tsx` | Implemented | All | 3 | 4 | 2 | 3 | 4 | 5 | 2 | 2 | 2 | Personalized re-engagement message based on user inactivity |

---

## Group 9: Partner / Location / Campaign

| Feature | Location | Status | Plan | User | Biz | Buyer | Data | Rev | Ret | Partner | Def | BvB | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| QR Campaign Tracking | `lib/campaigns.ts`, `app/api/campaign/track/route.ts`, `app/q/[code]/route.ts` | Implemented | All | 3 | 5 | 5 | 5 | 5 | 3 | 5 | 5 | 5 | Full funnel: scan → page view → calc → signup → return visit. Station-attributed. Locale-split (en/es). |
| Campaign Placements DB | `prisma/schema.prisma` (CampaignPlacement model) | Implemented | All | 2 | 5 | 5 | 5 | 5 | 3 | 5 | 4 | 5 | PostgreSQL. Per-placement code, station, city, contact, placement type, headline variant, featured flag. |
| Campaign Admin Dashboard | `app/admin/campaigns/page.tsx` | Implemented | Admin | 2 | 5 | 4 | 4 | 4 | 2 | 5 | 4 | 4 | Manage placements, view funnel stats, per-placement metrics, A/B headline variants |
| Featured Station | `lib/campaigns.ts` (featured field), `components/FeaturedStation.tsx` | Implemented | Partner | 3 | 4 | 5 | 4 | 4 | 3 | 5 | 4 | 4 | Partner stations marked featured are surfaced to GasCap users in that area |
| Partner Stations API | `app/api/partner-stations/route.ts` | Implemented | All | 3 | 4 | 5 | 4 | 4 | 3 | 5 | 4 | 4 | Returns featured partner stations near user location |
| Milestone Tier System | `lib/campaigns.ts` (getMilestoneTier) | Implemented | Partner | 2 | 4 | 4 | 3 | 4 | 3 | 5 | 3 | 3 | None / Partner / Gold / Premium at 25 / 100 / 250 signups |
| Campaign Lead Capture | `app/api/campaign/lead/route.ts` | Implemented | All | 2 | 4 | 4 | 4 | 4 | 3 | 4 | 3 | 3 | Captures email/phone before account creation; feeds into GHL |
| GHL Placement Webhook | `app/api/webhooks/ghl-placement/route.ts` | Implemented | Admin | 2 | 3 | 3 | 3 | 3 | 2 | 4 | 2 | 2 | Webhook from GHL to GasCap for placement events |

---

## Group 10: Fleet / Business

| Feature | Location | Status | Plan | User | Biz | Buyer | Data | Rev | Ret | Partner | Def | BvB | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Fleet Dashboard | `app/fleet/page.tsx` | Implemented | Fleet | 5 | 5 | 5 | 5 | 5 | 5 | 4 | 3 | 4 | Per-vehicle spending, driver attribution, monthly filtering |
| Driver Management | `app/api/fleet/drivers/route.ts` | Implemented | Fleet | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 3 | Add/remove up to 10 drivers per Fleet account |
| Fleet Branding | `app/api/fleet/branding/route.ts` | Implemented | Fleet | 3 | 3 | 3 | 2 | 3 | 3 | 3 | 2 | 2 | Company name + logo on PDF tax report |
| Annual Tax Report PDF | `app/api/fleet/tax-report/route.ts` | Implemented | Fleet | 5 | 5 | 5 | 4 | 5 | 5 | 4 | 3 | 4 | Full-year fuel cost PDF. Tax-ready. PDFKit. Gated to Fleet plan. |
| Bulk Vehicle Import | `app/api/vehicles/import/route.ts` | Implemented | Fleet | 4 | 4 | 4 | 3 | 4 | 3 | 3 | 2 | 2 | CSV upload for multiple vehicles |
| Multi-Driver Sub-Accounts | Listed in upgrade page as "coming soon" | Planned | Fleet | 4 | 5 | 4 | 4 | 5 | 4 | 3 | 3 | 3 | Not yet implemented in codebase |

---

## Group 11: Engagement & Monetization

| Feature | Location | Status | Plan | User | Biz | Buyer | Data | Rev | Ret | Partner | Def | BvB | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 30-Day Pro Trial | `lib/users.ts`, `app/api/auth/register/route.ts` | Implemented | All (auto) | 5 | 5 | 4 | 4 | 5 | 5 | 3 | 3 | 3 | Every signup gets 30-day Pro trial automatically. No credit card. |
| Stripe Checkout | `app/api/stripe/checkout/route.ts` | Implemented | Pro/Fleet | 5 | 5 | 4 | 3 | 5 | 5 | 3 | 3 | 3 | Monthly and annual billing. Coupon support. |
| Stripe Portal | `app/api/stripe/portal/route.ts` | Implemented | Pro/Fleet | 5 | 5 | 3 | 2 | 5 | 4 | 2 | 2 | 2 | Self-serve plan management |
| Stripe Webhook | `app/api/stripe/webhook/route.ts` | Implemented | Pro/Fleet | 3 | 5 | 3 | 3 | 5 | 3 | 2 | 2 | 3 | Handles subscription.created, updated, deleted; fires P1/P5 emails |
| Referral Program | `app/api/referral/route.ts`, `components/ReferralCard.tsx` | Implemented | All | 4 | 5 | 4 | 4 | 5 | 5 | 3 | 3 | 3 | Unique referral codes; 1 free Pro month per paying referral; Pro-for-life at 15 |
| Referral Leaderboard | `components/ReferralLeaderboard.tsx` | Implemented | All | 3 | 3 | 2 | 3 | 3 | 4 | 2 | 2 | 2 | Competitive referral ranking |
| Badge System | `lib/badges.ts`, `components/BadgeShelf.tsx` | Implemented | All | 4 | 3 | 2 | 3 | 3 | 5 | 2 | 2 | 2 | 12+ badges for calculations, streaks, vehicle saves, etc. |
| Streak Counter | `components/StreakCounter.tsx` | Implemented | All | 4 | 3 | 2 | 3 | 3 | 5 | 2 | 2 | 2 | Daily login streak with milestone rewards |
| Monthly Giveaway | `lib/giveaway.ts`, `app/giveaway/page.tsx` | Implemented | Pro/Fleet | 5 | 5 | 3 | 4 | 5 | 5 | 3 | 3 | 3 | $25 Visa prepaid card. Scales to $50 at 500 subscribers. Entries from daily activity + streak bonuses + early-upgrade bonus. |
| Field Ambassador Program | `lib/ambassador.ts`, `app/ambassador/page.tsx` | Implemented | Select | 4 | 5 | 4 | 4 | 5 | 5 | 4 | 4 | 4 | Pro-for-life in exchange for referral activity. QR sharing. Drip email sequence (C1-C5). |
| Upgrade Nudge Components | `components/UpgradeNudge.tsx`, `components/TrialExpiryBanner.tsx` | Implemented | Free/Trial | 3 | 5 | 3 | 3 | 5 | 3 | 2 | 2 | 2 | In-app conversion prompts |

---

## Group 12: Analytics & Data Infrastructure

| Feature | Location | Status | Plan | User | Biz | Buyer | Data | Rev | Ret | Partner | Def | BvB | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GA4 Integration | `components/GoogleAnalytics.tsx`, `lib/gtag.ts` | Implemented | All | 1 | 5 | 4 | 5 | 4 | 3 | 4 | 2 | 2 | Tracks page views + 9 named events. Measurement ID via env var. |
| Meta Pixel | `app/layout.tsx` | Implemented | All | 1 | 5 | 3 | 4 | 5 | 2 | 3 | 1 | 1 | PageView on every page. Pixel ID: 948950298128395. |
| GHL CRM Sync | `lib/ghl.ts` | Implemented | All | 1 | 5 | 4 | 4 | 5 | 3 | 4 | 3 | 3 | User contacts synced to GHL on register/upgrade/cancel. Plan tags applied. |
| OneSignal Push | `lib/oneSignal.ts`, `components/OneSignalProvider.tsx` | Implemented | All | 4 | 5 | 3 | 3 | 5 | 5 | 3 | 2 | 2 | Price alerts, fill-up reminders, weekly digest, broadcast |
| Email Campaign System | `lib/emailCampaign.ts`, `lib/emailCampaignPaid.ts` | Implemented | All | 4 | 5 | 3 | 4 | 5 | 5 | 2 | 3 | 3 | 10-email drip + comp ambassador + engagement tracks. Resend. |
| Email Log | `lib/emailLog.ts`, `prisma/schema.prisma` (EmailLog) | Implemented | Admin | 1 | 4 | 3 | 3 | 3 | 2 | 2 | 2 | 2 | Every sent email logged to PostgreSQL |
| Admin Analytics Dashboard | `app/admin/analytics/page.tsx`, `app/api/admin/analytics/route.ts` | Implemented | Admin | 1 | 5 | 4 | 5 | 4 | 2 | 4 | 3 | 3 | User metrics, plan distribution, engagement stats |
| Admin User Management | `app/api/admin/users/route.ts` | Implemented | Admin | 1 | 5 | 3 | 4 | 4 | 2 | 3 | 2 | 2 | View/manage all users, plans, trial status |
| GA4 Data API | `lib/ga4-data.ts` | Implemented | Admin | 1 | 4 | 3 | 4 | 3 | 2 | 3 | 2 | 2 | Server-side GA4 Data API integration for admin reporting |

---

## Group 13: Privacy & Security

| Feature | Location | Status | Plan | User | Biz | Buyer | Data | Rev | Ret | Partner | Def | BvB | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Privacy-Safe URL Construction | `lib/googleMaps.ts`, `lib/waze.ts` | Implemented | All | 3 | 5 | 5 | 5 | 3 | 2 | 5 | 4 | 4 | No PII (email, userId, VIN, vehicleName) in any Maps/Waze URL. Documented explicitly. |
| Email Unsubscribe | `app/api/email/unsubscribe/route.ts` | Implemented | All | 4 | 5 | 4 | 2 | 3 | 2 | 3 | 2 | 2 | One-click unsubscribe. Sets emailOptOut=true. |
| Account Deletion Log | `prisma/schema.prisma` (DeletedAccountLog) | Implemented | Admin | 3 | 5 | 4 | 3 | 3 | 2 | 3 | 2 | 2 | Snapshot before deletion. GDPR-adjacent readiness. |
| Email Verification | `app/api/auth/verify-email/route.ts` | Implemented | All | 4 | 4 | 3 | 2 | 3 | 3 | 2 | 2 | 2 | Token-based email verification |
| Password Reset | `app/api/auth/reset-password/route.ts` | Implemented | All | 4 | 4 | 3 | 2 | 3 | 2 | 2 | 2 | 2 | Secure token-based password reset |
| NextAuth JWT Sessions | `lib/auth.ts` | Implemented | All | 3 | 5 | 4 | 2 | 4 | 3 | 3 | 3 | 3 | CredentialsProvider + JWT. bcryptjs password hashing. |

---

## Features Flagged for Verification

- **Vehicle limit for Pro plan** — `lib/stripe.ts` PRICING.pro.vehicles = 5, but upgrade page shows "Up to 3 saved vehicles." Needs reconciliation. TODO: verify which limit is enforced in `app/api/vehicles/route.ts`.
- **Route-Based Trip Planner** — Code is implemented and gated by `GOOGLE_MAPS_TRIP_PLANNER_ENABLED=true` env var. TODO: confirm whether this is set in production on Railway.
- **Multi-driver sub-accounts** — Listed as "coming soon" on upgrade page. No implementation found in codebase beyond the `fleetDrivers` array field on the User model and `app/api/fleet/drivers/route.ts`. TODO: determine scope of "coming soon" before positioning as an existing feature.
- **Receipt scan AI provider** — Comment in email says "GPT-4o Vision" for receipt scan. AI Chat uses Claude (Anthropic). Confirm which AI provider is used for `app/api/fillups/scan/route.ts`.

---

*Internal strategic document. Codebase audit: May 2026.*
