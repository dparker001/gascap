# Rental Mode — Quick-Save Upcoming Rentals + Email Booking Import

**Status: PLANNED** (2026-10-02). Nothing here is implemented. Written against
`main` @ `eb7ef00` (after PR #58, Rental Event Timezones).
**Owner decisions required before build:** see §6.

## 1. Problem

A renter who books weeks ahead wants to save the rental now and finish it at
the counter. Today the setup wizard (`components/rental-return/RentalSetupFlow.tsx`)
blocks that:

| Wizard requirement | Where | Why it hurts an advance booking |
|---|---|---|
| Vehicle make + model + tank size > 0 | `canNext2` | Reservations say "Camry **or similar**" — the real car is unknown until the counter |
| Return date/time | `canSubmit` | Usually known — fine |
| All 7 steps clicked through | wizard | Most are optional, but you still walk them |

The server (`POST /api/rental-sessions`) only requires `rentalCompany`, and every
vehicle/fuel column on `RentalSession` is already nullable — the constraint is
UI-only.

Separately, the renter already has the booking in their inbox. Typing it in
at all is friction we can remove.

## 2. Goals / non-goals

**Goals**
- A ~1-minute "save as upcoming" path with only what a booking knows.
- A clear "finish at the counter" flow that never invents a number.
- Forward a reservation email → a pre-filled upcoming rental to review.
- Works identically on web, iOS and Android (native shells load the live web app — no Codemagic rebuild).

**Non-goals**
- Rental-company API sync (Hertz/Avis/Enterprise). Out of scope by project
  rule: needs approved credentials and a written spec
  (`docs/RENTAL_INTEGRATION_LEVEL2.md`).
- Reading the user's mailbox (Gmail/Outlook OAuth). Forwarding only.
- Auto-creating active rentals from email without the user confirming.

## 3. Part A — Quick-save upcoming rental

### 3.1 Flow
1. **New Rental → "Booked ahead? Save it as upcoming"** (second entry point
   beside the full wizard; the full wizard stays as-is).
2. One screen: rental company · confirmation number (optional) · pickup
   location + date/time · return location + date/time. Uses the existing
   `RentalEventScheduleField` (per-event zones, DST prompts, Places zones).
3. **Save.** Vehicle, tank size, pickup fuel, fuel rate, photos all stay null.
   Return policy defaults to `same_as_pickup` (target null until pickup fuel
   exists — current behaviour of `resolveRequiredReturnFuel`).

Pickup date/time becomes **required** on this path (it is what makes the
rental "upcoming" and drives the pickup reminders); it stays optional in the
full wizard.

### 3.2 "Finish setup" at the counter
The dashboard shows a checklist card while any of these are missing, in this
order (each step depends on the previous):

1. **Vehicle** — VIN scan or Year/Make/Model lookup (existing Edit controls) → sets tank size.
2. **Tank size** — only if step 1 didn't provide one.
3. **Pickup fuel level** — existing "Set your pickup fuel level" card.
4. Optional: scan the agreement, fuel rate, photos.

Rules (per CLAUDE.md "Never invent a reading"):
- Unknown tank or pickup fuel renders as **unknown** — no `?? 0` in any
  displayed number, status chip or calculation. Add Fuel / Prepare for Return
  stay disabled with a "finish setup first" explanation.
- Gauge/percent pickup readings are blocked until a tank size exists (they
  can't be converted to gallons without one).

### 3.3 Known code gaps to fix in Part A
- **Tank null → value never recomputes a `full` return target.** In
  `updateRentalSession`, `capChanged` requires `oldCap != null`, so setting
  a tank for the first time leaves `requiredReturnFuelGallons` null under the
  `full` policy. Fix: on first tank set, recompute via
  `resolveRequiredReturnFuel`. Regression test required (fuel calculation).
- Audit `RentalDashboard.tsx` (`tankCapacity = session.fuelTankCapacityGallons ?? 0`
  and its `> 0` guards) so every path with a null tank shows unknown, not 0.
- Rental Details on an *upcoming* rental labels times "Picked Up / Returned"
  (seen in the 2026-10-02 smoke test) — use "Pickup / Return".

### 3.4 Reminders
The ~2h pickup reminder (email + push, `app/api/cron/rental-return-reminder`)
already deep-links to the rental. When setup is incomplete, its copy should
say "finish setting up your rental at the counter" instead of only "record
pickup fuel". **Cron copy change — requires Don's approval; no window or
logic change.**

### 3.5 Part A data impact
None. No schema change, no migration, no backfill.

## 4. Part B — Email booking import

### 4.1 User experience
1. My Rentals shows **"Import a booking by email"** with the user's private
   forwarding address and a Copy button, e.g. `r-7k2m9q4x@rentals.gascap.app`.
2. The user forwards the rental company's confirmation email there.
3. Within ~1 minute: email + push **"We found your Hertz rental — review it"**
   → opens a pre-filled quick-save screen (Part A) showing what was read.
4. The user corrects anything, then **Save** → a normal upcoming rental.
   Nothing becomes a rental until the user confirms.
5. If nothing could be read: a short email back ("We couldn't read that
   booking — you can add it manually in a minute").

### 4.2 Architecture (recommended)

```
rental company email
  → user forwards to  <token>@rentals.gascap.app
  → Cloudflare Email Routing (subdomain MX)  → Email Worker
  → HTTPS POST raw MIME → /api/rental-import/inbound   (shared secret header)
  → verify secret (constant-time; 503 if unset — fail closed)
  → token → user; DB plan check (lib/serverPlan.ts) → Pro only
  → rate limit (e.g. 10/user/day), size cap (e.g. 2 MB)
  → extract text + PDF attachment → Claude extraction (shared with scan-agreement)
  → RentalImport row (status 'pending', extracted fields only)
  → notify user (email + push)
  → user reviews in app → POST /api/rental-sessions via an EmailImportProvider.normalize()
```

- **Why a subdomain:** MX on `rentals.gascap.app` cannot affect mail to
  `admin@gascap.app`. gascap.app DNS is already on Cloudflare.
- **Alternative:** Resend inbound (we already send through Resend). Verify
  current availability, pricing and payload shape against Resend's docs
  before choosing (provider-contract testing rule).
- **Provider abstraction:** an `EmailImportProvider` normalizes into the
  same model as `ManualRentalDataProvider` (`lib/rentalProvider.ts`
  capabilities: no fuel levels, maybe vehicle class, locations/times yes).
- **Extraction:** refactor the prompt in
  `app/api/rental-sessions/scan-agreement/route.ts` into a shared lib and add
  `pickupLocation` and an explicit "vehicle class / or similar" field. The
  model must return null rather than guess (existing rule). An "or similar"
  vehicle is **not** stored as the vehicle; it's shown as a hint only.
- **Time zones:** the email gives local wall times with no zone. On review,
  each event's zone comes from its location via the existing Places path
  (`includeTimeZone`); otherwise device zone, labelled "assumed". The normal
  create path validates DST and derives UTC — imported data never bypasses it.

### 4.3 Security
- The **private token address is the authentication.** A shared
  `rentals@gascap.app` matched by sender address is rejected: From headers
  are spoofable, and people often forward from a different address than
  their GasCap login.
- Token: ≥ 64 bits random, rotatable from the app ("Get a new address"),
  revocable. Unknown token → silently drop (no bounce oracle).
- Inbound endpoint: secret required, fail closed (503 when unset), never log
  the secret or the email body; log only token prefix, size, outcome.
- Imports are suggestions requiring in-app confirmation, so a leaked address
  can at worst create a pending suggestion — never a rental, reminder or charge.
- Optionally record SPF/DKIM results from Cloudflare for diagnostics; do not
  rely on them for authorization.

### 4.4 Privacy / retention
- **Raw email is never stored.** Process in memory; persist extracted fields
  only.
- Confirmation emails contain names, addresses, sometimes partial card
  numbers — the extraction schema has no fields for them, and nothing is
  logged.
- Pending imports expire after 30 days (cleanup in an existing daily cron —
  no new cron fire-time).
- Privacy Policy + Help get one paragraph on email import before launch.

### 4.5 Part B data impact (requires approval)
Additive only, direct SQL, nullable, no backfill:
- `User.rentalImportToken` TEXT NULL, unique index.
- New table `RentalImport` (id, userId, status pending|confirmed|dismissed|failed,
  extracted JSON, createdAt, expiresAt, rentalSessionId NULL).

### 4.6 Cost
- One Claude call per forwarded email (same order as one agreement scan).
  Pro-gated, rate-limited, size-capped. Model choice to be measured: try a
  smaller model on text-only emails, keep the current model for PDFs.
- Cloudflare Email Routing/Workers: expected free tier at our volume (verify).

## 5. Rollout

| Phase | Ships | Schema | External setup |
|---|---|---|---|
| **A** Quick-save + Finish setup + tank-recompute fix | web (all platforms) | none | none |
| **B1** Inbound plumbing behind a flag, Don's account only | endpoint + worker | additive (§4.5) | subdomain MX + Email Worker |
| **B2** Review screen + notifications, Pro users | web | none | none |

Each phase: own branch + PR + ChatGPT review (Rental Mode, schema, new
infrastructure, AI cost all trigger review per CLAUDE.md). B1 needs a
read-only live smoke test with real forwarded emails from at least Hertz,
Avis, Enterprise before B2.

## 6. Decisions for Don

1. **Approve Part A as specified?** (incl. pickup time required on the quick path)
2. **Pickup-reminder copy change** for incomplete setups (§3.4)?
3. **Inbound provider:** Cloudflare Email Routing + Worker (recommended) or Resend inbound?
4. **Address domain:** `rentals.gascap.app` (recommended) or another subdomain?
5. **Pro-only** for email import (recommended — AI cost, matches agreement scan)?
6. **Schema additions** in §4.5 (separate authorization at B1, as with PR #58)?

## 7. Testing (per CLAUDE.md)
- Part A: regression tests for tank null→value recompute (fails on current
  code), unknown-not-zero rendering, quick-save create payload (no vehicle,
  no fuel), Finish-setup ordering.
- Part B: inbound auth fail-closed (missing secret → 503, bad secret → 401),
  unknown token dropped, rate limit, size cap, no raw body persisted, Pro
  gate from DB, extraction returns nulls rather than guesses; provider
  payload mocks built from the chosen provider's **official** sample
  payloads, with at least one positive real-shape path.
