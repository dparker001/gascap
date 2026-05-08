# GasCap™ Data Privacy and Compliance

> **INTERNAL DOCUMENT — NOT FOR PUBLIC DISTRIBUTION**

---

## Data Collected

The following data is collected and stored by GasCap™ as of May 2026.

### User Account Data (PostgreSQL via Prisma — User model)
- Name, email, password (bcryptjs hash only — plaintext never stored)
- Plan tier (free / pro / fleet)
- Registration timestamp
- Login count and last login timestamp
- Email verification status and tokens
- Password reset tokens (hashed, expiring)
- Locale (en / es)
- Phone number (optional, if provided by user)
- Display name (optional)
- Avatar URL (optional)
- Preferred fill level (%)
- Monthly fuel budget goal ($ amount)
- Price alert threshold ($/gallon)
- Push notification subscription status
- Email opt-out flag
- Referral code and referral tracking data
- Stripe customer ID and subscription ID (references, not payment data)
- GasCap-specific engagement metrics: calc count, budget calc count, location lookups, active days, streak, badges
- Email campaign enrollment state
- Giveaway entry tracking

### Vehicle Data (PostgreSQL via Prisma — Vehicle model)
- Vehicle name (user-defined)
- Tank capacity (gallons)
- VIN (optional, user-provided)
- Year, make, model, trim (optional)
- Fuel type (optional)
- EPA ID (used to fetch MPG data)
- Current odometer reading (optional)
- Vehicle specs from EPA/VIN lookup (stored as JSON)

### Fill-Up Log Data (JSON file store — `data/fillups.json`)
- User ID reference
- Vehicle ID reference
- Date of fill-up
- Gallons pumped
- Price per gallon
- Total cost (calculated)
- Odometer reading (optional)
- Fuel level before fill-up (optional, percentage)
- Station name (optional, user-entered)
- Notes (optional)
- Driver label (Fleet only — user-entered text)

### Trip Data (JSON file store — `data/trips.json`)
- User ID reference
- Origin and destination (as entered by user — free text, may include addresses)
- Route distance and fuel calculations
- Fuel stop selections

### Campaign/Partner Data (PostgreSQL — CampaignPlacement model)
- QR placement code, location, station name/address, contact info
- Events logged per scan: placement code, session ID (opaque), user agent, referrer, path, locale, event type, timestamp

### Email Log (PostgreSQL — EmailLog model)
- User ID, email, name, email type, subject, send timestamp, delivery status

### Deleted Account Log (PostgreSQL — DeletedAccountLog model)
- Snapshot of user info at time of deletion: name, email, plan, deletion date, reason

---

## Data That Must NEVER Go to External URLs

This is a hard privacy rule enforced in `lib/googleMaps.ts` and `lib/waze.ts` with explicit code comments:

**Never include in any Google Maps, Waze, or other external navigation URL:**
- User email address
- User ID
- VIN number
- Vehicle name
- Odometer reading
- Exact fill-up amounts
- Any database record IDs

This rule exists because:
1. External navigation apps may log URL parameters for their own analytics
2. URLs may appear in browser history, server logs, or referrer headers
3. Privacy regulations (CCPA, GDPR) treat navigation behavior as potentially sensitive

**Current implementation:** `lib/googleMaps.ts` explicitly documents this rule and includes only: destination coordinates (for directions mode) or a generic search query (for search mode). The origin location is omitted from search-mode URLs entirely; Google Maps uses the device's own GPS.

---

## Location Data Handling

- User location is obtained via the browser's Geolocation API (`navigator.geolocation.getCurrentPosition`)
- Location is used only to determine the user's state for EIA gas price lookup (Nominatim reverse geocode)
- State-level data is retained for price lookup; city/coordinates are NOT stored in the database
- For navigation handoffs: user coordinates are passed to Waze deep links in search mode only (not logged, not stored). For Google Maps search mode, coordinates are intentionally omitted.
- No third-party location data sharing occurs

---

## Analytics Privacy Rules

### Google Analytics 4 (GA4)
- GA4 is configured with standard gtag; no custom user ID linking is performed
- Events include only bucketed or categorical properties — no exact dollar amounts, no location below state, no user-identifying text
- GA4 event properties are designed to be anonymous: `user_plan` (free/pro/fleet), `calc_type` (target/budget), `mode` (search/directions), `source` (string category)
- GA4 data is subject to Google's data retention policies and standard anonymization

### Meta Pixel
- PageView fires on every page — no custom event properties with PII
- Standard events (Lead, Purchase) should be configured to fire on account creation and upgrade, respectively — these should be reviewed before implementation to ensure no PII is included in `eventData`
- Meta Pixel data is subject to Meta's data practices and the app's Privacy Policy

### Campaign Events (internal)
- Session IDs are opaque random strings — not linked to user identity until the user creates an account
- User ID is added to campaign events only after signup
- Campaign events are stored internally (not shared with any third party)

---

## Consent and Opt-Out

### Email Marketing
- Users can unsubscribe from marketing emails via the one-click unsubscribe link in every email
- Unsubscribe sets `emailOptOut=true` in the database; all campaign cron jobs filter this field
- GHL CRM sync respects opt-out status (TODO: verify GHL opt-out flag is set on unsubscribe)
- Account-related transactional emails (email verification, password reset, subscription confirmation) are sent regardless of opt-out

### Push Notifications
- OneSignal push requires explicit browser permission grant
- Users can disable via browser settings or the in-app `FillupReminderToggle` / `PushNotificationToggle`
- Push notifications are never sent without user permission

### SMS
- SMS opt-in is tracked via `smsOptIn` and `smsOptInDate` fields
- A2P submission in progress as of May 2026 (GHL number: +13215131321)
- Opt-in URL for A2P compliance: https://www.gascap.app/contact

### Cookie / Tracking Consent
- TODO: A cookie consent banner is not currently implemented. This is required for GDPR compliance if the app targets EU users. The Meta Pixel and GA4 fire without explicit consent. This is a compliance gap.

---

## Data Retention

| Data Type | Current Retention | Recommended Retention Policy |
|---|---|---|
| User account data | Indefinite (until account deletion) | As long as account is active + 30 days after deletion |
| Fill-up logs | Indefinite | As long as account is active + 30 days after deletion |
| Email logs | Indefinite | 12 months rolling |
| Deleted account log | Indefinite | 24 months (for dispute resolution) |
| Campaign events | Indefinite (JSON file) | 12 months rolling; export to analytics before purge |
| Password reset tokens | Set to expire (field: passwordResetExpires) | Already implemented |
| Email verification tokens | Set to expire (field: emailVerifyExpires) | Already implemented |

---

## Account Deletion and Data Export

### Account Deletion
- Users can request account deletion (contact form or admin action)
- The `DeletedAccountLog` model captures a snapshot before deletion
- Cascade delete is configured: `Vehicle` records cascade when `User` is deleted (`onDelete: Cascade` in Prisma schema)
- Fill-up logs are stored in a JSON file (not PostgreSQL) — deletion must be performed manually or via a dedicated route (TODO: verify `/api/user/profile` DELETE includes fill-up log cleanup)
- GHL CRM contact deletion: TODO — no automatic GHL contact removal on account deletion

### Data Export (GDPR / CCPA Readiness)
- Fill-up CSV export is implemented (`app/api/fillups/export/route.ts`) — users can export their own fill-up data
- Full account data export (vehicle data, preferences, settings) is NOT currently implemented — this is a gap
- TODO: Implement `/api/user/export` route that packages all user data as a downloadable JSON or ZIP

---

## API Key Security

All sensitive API keys are environment variables, never committed to source code:

| Key | Where Used | Stored In |
|---|---|---|
| `STRIPE_SECRET_KEY` | Server-side Stripe calls | Railway env var |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification | Railway env var |
| `NEXTAUTH_SECRET` | JWT signing | Railway env var |
| `EIA_API_KEY` | Gas price lookups | Railway env var |
| `GASCAP_ANTHROPIC_KEY` | AI Fuel Advisor | Railway env var |
| `GOOGLE_MAPS_API_KEY` | Maps/Places API (server-side only) | Railway env var |
| `ONESIGNAL_REST_API_KEY` | Push notifications (server-side) | Railway env var |
| `GHL_API_KEY` | GHL CRM sync | Railway env var |
| `CRON_SECRET` | GitHub Actions cron authentication | GitHub Secret |
| `RESEND_API_KEY` | Email sending | Railway env var |

**Important:** `GOOGLE_MAPS_API_KEY` is server-side only and is never sent to the client. The client uses public deep-link URLs (no API key required) for Google Maps and Waze navigation handoffs.

---

## Terms of Service and Privacy Policy

- Terms of Service: https://www.gascap.app/terms
- Privacy Policy: https://www.gascap.app/privacy

### Gaps to Address Before Partnership or Acquisition Conversations
- [ ] Cookie consent banner (GDPR compliance for EU users)
- [ ] Explicit data processing agreement (DPA) template for B2B partners
- [ ] Privacy Policy update to describe AI features (receipt scan, AI advisor)
- [ ] Privacy Policy update to describe GHL CRM sync and data sharing
- [ ] Data export route for user data portability (CCPA/GDPR)
- [ ] Verify GHL opt-out sync on email unsubscribe
- [ ] Verify fill-up log cleanup on account deletion
- [ ] Add cookie policy section to Privacy Policy

---

## Compliance Posture

| Area | Current Status | Gap |
|---|---|---|
| CCPA (California) | Partial | Data export not implemented; opt-out mechanism exists |
| GDPR (EU) | Weak | No cookie consent; no DPA; no data export |
| CAN-SPAM | Compliant | One-click unsubscribe implemented; required fields present |
| A2P SMS | In progress | Submission pending (May 2026) |
| PCI DSS | Not applicable | Stripe handles all payment processing; GasCap™ never touches card data |

---

*Internal strategic document. May 2026.*
