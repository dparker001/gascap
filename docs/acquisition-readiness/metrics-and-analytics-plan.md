# GasCap™ Metrics and Analytics Plan

> **INTERNAL DOCUMENT — NOT FOR PUBLIC DISTRIBUTION**
> This document covers what is currently tracked, what gaps exist, and the full desired event schema for acquisition-readiness.

---

## What Is Currently Tracked (Verified from Codebase)

### Meta Pixel (Pixel ID: 948950298128395)
- **PageView** — fires on every page load via `fbq('track', 'PageView')` in `app/layout.tsx`
- **Standard events** via `fbTrack()` in `lib/gtag.ts` — callable from components but custom event firing must be verified per component. TODO: audit which components actually call `fbTrack()`.

### Google Analytics 4 (via `lib/gtag.ts` and `components/GoogleAnalytics.tsx`)
- **page_view** — automatic on every route change (SPA-aware via `PageViewTracker`)
- **calculate** — `calc_type: 'target'` or `calc_type: 'budget'`
- **gas_price_lookup** — user triggered a live price lookup
- **sign_up** — account creation (`method: 'credentials'`)
- **upgrade_click** — user clicked any upgrade CTA (`source: string`)
- **log_fillup** — user logged a fill-up
- **save_vehicle** — user saved a vehicle
- **referral_share** — user clicked the referral share button
- **qr_scan** — QR placard redirect (`placement_code: string`)
- **google_maps_open** — Maps handoff (`mode: string`, `user_plan: string`)

### Campaign Tracking System (PostgreSQL + JSON file)
All events stored in `data/campaign-events.json`:
- **scan** — QR code scanned (redirect endpoint hit)
- **page_view** — landing page loaded after QR redirect
- **calc_start** — user began using calculator (from campaign landing)
- **calc_complete** — calculator returned a result
- **save_to_phone** — PWA install prompt / manual save
- **lead_capture** — email/phone captured before account creation
- **signup** — full account created (attributed to placement)
- **return_visit** — same attribution cookie returned in new session

All campaign events include: `placementCode`, `sessionId`, `userId` (once signed up), `path`, `userAgent`, `referrer`, `meta` (including locale: en/es).

### GHL CRM (via `lib/ghl.ts`)
Tags applied to GHL contacts: `gascap-free`, `gascap-pro`, `gascap-fleet`, `gascap`
Events that trigger GHL sync: registration, upgrade, plan change, cancellation

### Email System (Resend via `lib/emailLog.ts`)
All emails logged to PostgreSQL (EmailLog model) with: userId, userEmail, userName, type, subject, sentAt, status, error.
Email types tracked: `trial-d1` through `trial-d5`, `p1` through `p5`, `comp-c1` through `comp-c5`, `engagement`, `referral-credit`, `trial-ended`, `verify-reminder`, `verify-bonus`.
Open/click tracking: Resend tags applied for segmentation (`campaign`, `step`).

---

## Analytics Gaps (Not Currently Tracked)

| Gap | Impact | Priority |
|---|---|---|
| Locked feature exposure events | Can't measure conversion funnel from feature gate | High |
| Upgrade prompt click-through rate | Can't optimize upgrade copy | High |
| Rental Return Mode toggle rate | Key differentiating feature — no specific tracking | High |
| Smart Fill-Up Optimizer usage | High-value Pro feature — no specific event | High |
| Receipt scan attempts and success rate | AI feature quality signal | Medium |
| Fill-up reminder push notification CTR | Engagement loop quality | Medium |
| AI Advisor question topics (anonymized) | Product intelligence — what do users ask? | Medium |
| Trip planner usage (when activated) | High-value Pro feature | Medium |
| Waze handoff rate vs. Google Maps rate | Navigation partner data | Medium |
| Session depth (calculations per session) | Engagement quality | Medium |
| PWA install rate | Platform metric | Low |
| Dark mode vs. light mode preference | UX signal | Low |
| Language (en/es) distribution | Localization priority signal | Medium |

---

## Desired Full Event Schema

### Acquisition / Traffic Events

| Event Name | Trigger | Properties | Privacy Notes | Plan Relevance | Acquisition Value |
|---|---|---|---|---|---|
| `page_view` | Any page load | `page_path`, `page_title` | No PII | All | Medium |
| `qr_scan` | QR redirect endpoint `/q/[code]` | `placement_code`, `campaign`, `locale` | No PII | All | High |
| `landing_page_view` | Campaign landing page loads | `placement_code`, `source`, `locale` | No PII | All | High |
| `referral_link_click` | User visits site via referral URL | `referrer_code` | No PII | All | High |
| `organic_search_visit` | GA4 session source | Auto-tracked by GA4 | No PII | All | Medium |

### Activation Events

| Event Name | Trigger | Properties | Privacy Notes | Plan Relevance | Acquisition Value |
|---|---|---|---|---|---|
| `sign_up` | Account created | `method`, `locale`, `source` (organic/qr/referral) | No PII | All | Critical |
| `email_verified` | Email verification link clicked | — | No PII | All | High |
| `first_vehicle_saved` | First vehicle saved | `has_vin`, `fuel_type` | No vehicle PII | Free/Pro/Fleet | High |
| `first_calculation` | First calculator result | `calc_type`, `plan` | No PII | All | High |
| `first_fillup_logged` | First fill-up logged | `has_odometer` | No PII | Pro/Fleet | High |
| `onboarding_completed` | Setup checklist fully complete | — | No PII | All | High |
| `pwa_installed` | PWA install prompt accepted | `platform` (ios/android/desktop) | No PII | All | Medium |

### Engagement Events

| Event Name | Trigger | Properties | Privacy Notes | Plan Relevance | Acquisition Value |
|---|---|---|---|---|---|
| `calculate` | Calculator result rendered | `calc_type` (target/budget), `plan`, `has_saved_vehicle`, `has_live_price` | No PII | All | High |
| `gas_price_lookup` | Live price fetch triggered | `locale`, `geolocation_granted` | No PII | All | Medium |
| `log_fillup` | Fill-up saved | `has_odometer`, `plan`, `has_vehicle_id`, `station_name_provided` | No PII | Pro/Fleet | High |
| `receipt_scan_attempted` | Receipt photo uploaded | — | No PII | Pro/Fleet | High |
| `receipt_scan_success` | AI extraction succeeded | `fields_extracted` (gallons/price/date) | No PII | Pro/Fleet | High |
| `vin_scan_attempted` | VIN photo uploaded | — | No PII | Pro | Medium |
| `mpg_chart_viewed` | MPG chart rendered | `data_points` | No PII | Pro/Fleet | Medium |
| `ai_advisor_question` | AI question submitted | `is_suggested`, `question_topic` (anonymized category) | No vehicle names, no user input text | Pro/Fleet | High |
| `rental_return_mode_toggled` | Rental mode toggle activated | `plan` | No PII | All | High |
| `rental_savings_calculated` | Rental return result rendered | `savings_amount_bucket` ($0-25 / $25-50 / $50-100 / $100+) | No exact dollar amounts that could identify user | Pro | Very High |
| `fillup_optimizer_run` | Smart optimizer result rendered | `recommendation` (fill_now/wait/neutral), `state`, `savings_bucket` | No PII | Pro/Fleet | Very High |
| `price_alert_set` | User sets price threshold | `threshold_bucket` | No exact threshold | Pro/Fleet | High |
| `price_alert_triggered` | Push sent on price drop | `state`, `drop_amount_bucket` | No PII | Pro/Fleet | High |
| `trip_plan_created` | Route-based trip plan generated | `distance_bucket`, `stops_needed`, `plan` | No origin/destination | Pro/Fleet | High |
| `fuel_stop_selected` | User picks a fuel stop from results | `station_index` (1st/2nd/3rd) | No station name | Pro/Fleet | Very High |
| `google_maps_open` | Maps handoff tapped | `mode` (search/directions), `user_plan`, `source` (trip/calc/standalone) | No PII — privacy rules enforced in URL builder | All | Very High |
| `waze_handoff` | Waze handoff tapped | `has_coords`, `user_plan` | No PII | All | High |
| `maintenance_reminder_viewed` | Maintenance reminder surfaced | `type` (oil/rotation/etc), `miles_to_due_bucket` | No PII | Pro/Fleet | Medium |
| `streak_milestone` | User hits streak milestone | `streak_days` | No PII | All | Medium |
| `badge_earned` | Badge awarded | `badge_id` | No PII | All | Medium |
| `referral_share` | Share button tapped | `share_method` (copy/qr) | No PII | All | High |
| `giveaway_entry_earned` | Entry credited | `source` (daily/streak/early-upgrade/referral) | No PII | Pro/Fleet | Medium |

### Monetization Events

| Event Name | Trigger | Properties | Privacy Notes | Plan Relevance | Acquisition Value |
|---|---|---|---|---|---|
| `upgrade_click` | Any upgrade CTA clicked | `source` (feature/banner/nudge/email), `cta_type`, `current_plan` | No PII | Free/Trial | Critical |
| `locked_feature_shown` | Free user hits Pro gate | `feature_key`, `page`, `current_plan` | No PII | Free | High |
| `upgrade_page_viewed` | /upgrade page loaded | `billing_toggle`, `referrer`, `coupon_applied` | No PII | All | Critical |
| `upgrade_initiated` | Stripe checkout started | `tier`, `billing_interval` | No PII | Free/Trial | Critical |
| `upgrade_completed` | Stripe webhook success | `tier`, `billing_interval`, `is_trial_conversion` | No PII | Free/Trial | Critical |
| `trial_conversion` | Trial user becomes paying | `days_into_trial`, `tier`, `billing_interval` | No PII | Trial | Critical |
| `subscription_cancelled` | Stripe subscription.deleted | `tier`, `tenure_months`, `reason` (from optional cancel survey) | No PII | Pro/Fleet | Critical |
| `referral_converted` | Referred user becomes paying | — | No PII | All | High |

### Fuel-Intent Events (Key Acquisition Value)

| Event Name | Trigger | Properties | Privacy Notes | Acquisition Value |
|---|---|---|---|---|
| `fuel_intent_signal` | Any calculator result | `tank_pct_before`, `target_pct`, `gallons_needed_bucket`, `price_per_gallon_bucket`, `state`, `time_of_day`, `day_of_week` | All bucketed — no exact values, no location below state level | Very High |
| `pre_navigation_calculation` | Calculator → Maps/Waze handoff in same session | `calc_type`, `user_plan`, `nav_app` | No PII | Very High |
| `post_fillup_context` | Fill-up logged within 2h of a calculation | `calc_type`, `gallons_delta` (planned vs. actual, bucketed) | No PII | Very High |

### Partner / Campaign Events

| Event Name | Trigger | Properties | Privacy Notes | Acquisition Value |
|---|---|---|---|---|
| `qr_scan` | Redirect endpoint hit | `placement_code`, `campaign`, `locale` | No PII | Very High |
| `campaign_signup` | Account created after QR scan | `placement_code`, `days_to_convert` | No PII | Very High |
| `campaign_return_visit` | Attribution cookie recognized on return | `placement_code`, `days_since_first_scan` | No PII | High |
| `featured_station_clicked` | User taps a featured partner station | `station_code` | No PII | Very High |

---

## Metric Categories and KPIs

### Acquisition Metrics
- New signups per day / week / month
- Signups from QR campaigns (with placement attribution)
- Signups from referral links
- Organic vs. campaign-attributed breakdown
- Cost per acquisition (when paid marketing runs)

### Activation Metrics
- % of signups who complete first calculation (same session)
- % of signups who save a vehicle (first 7 days)
- % of signups who log first fill-up (first 14 days)
- % of signups who verify email (first 48h)
- Onboarding checklist completion rate

### Engagement Metrics
- DAU / MAU ratio (stickiness)
- Calculations per active user per month
- Fill-ups logged per Pro/Fleet user per month
- Streak distribution (0-6d / 7-29d / 30-89d / 90d+)
- AI advisor questions per Pro user per month
- Push notification open rate

### Revenue Metrics
- Trial → Paid conversion rate (target: ≥10% per deferred sprint decision gate)
- Monthly Recurring Revenue (TODO: pull from Stripe dashboard — never fabricate)
- Annual Recurring Revenue
- Average Revenue Per User (ARPU)
- Churn rate (monthly and annual subscribers)
- Revenue by plan tier (Free / Pro Monthly / Pro Annual / Fleet Monthly / Fleet Annual)
- Referral program contribution to revenue

### Fuel-Intent Metrics (For Strategic Positioning)
- Calculations per month (total)
- Navigation handoffs per month (Google Maps + Waze)
- Rental return mode calculations per month
- Smart optimizer runs per month
- Average recommended savings per optimizer run

### Partner Metrics
- Active placements (QR codes)
- Scans per placement per week
- Scan → signup conversion rate
- Signups attributed to partner stations (total)
- Partner milestone tier distribution (none / partner / gold / premium)

---

## Analytics Architecture Recommendations

### Short-Term (Before Partner/Investor Conversations)
1. Add `locked_feature_shown` event to all Pro feature gates
2. Add `rental_return_mode_toggled` event
3. Add `fillup_optimizer_run` event with recommendation and savings bucket
4. Fire `fbTrack('Purchase', ...)` on Stripe webhook success (for Meta pixel conversion tracking)
5. Fire `fbTrack('Lead', ...)` on signup (for Meta pixel lead tracking)
6. Set up GA4 conversion goals: sign_up, upgrade_completed, trial_conversion

### Medium-Term (Before Acquisition Conversations)
1. Build a fuel-intent aggregate dataset: monthly calculations by state, time of day, day of week (all anonymized, no user-level data)
2. Export campaign funnel data from campaign-events.json to a queryable data store (PostgreSQL preferred, replacing the JSON file for events)
3. Create a partner reporting dashboard showing attribution metrics by station

### Data Minimization Commitments (Required Before Any Data Partnership)
- No event should include user email, name, user ID, VIN, vehicle name, or odometer reading
- Location data stops at the state level (never city/zip/coordinates in analytics)
- Dollar amounts are bucketed, never exact
- AI question topics are categorized, never exact user text
- All analytics are aggregate and anonymized before sharing with any external party

---

*Internal strategic document. May 2026.*
