# Assisted Fill-Up — MVP Architecture and UX Specification

**Status:** `PLANNED`. **Nothing in this document is implemented.** It is an
implementation-ready specification awaiting Don's authorization to build. It
is not a description of current architecture — see `docs/SYSTEM.md` and
`README.md` for that.

**Workstream:** 02 — Smart Fuel Automation, Phase 2
**Date:** 2026-10-20
**Author:** Claude Code
**Baseline:** `main` @ `26f6cfa`, plus WS02 Phase 1 (PR #87, `e7a62b2`)

---

## 1. What this is, and what it deliberately is not

**Is:** a foreground, opt-in prompt. The renter opens GasCap, GasCap notices
they appear to be at a gas station, and offers to start a fill-up with the
station, the vehicle and the price already filled in. They review and confirm.

**Is not:** background visit detection. The Phase 5 discovery audit
(`docs/reviews/2026-10-20-workstream01-phase5-automation-discovery.md` §B2)
established by direct code audit that GasCap has **no** background-location
capability: zero `watchPosition` calls, no geofencing or region-monitoring
code anywhere, no location plugin in `capacitor.config.ts`, and
`@capacitor/geolocation` v6.1.1 is foreground-only. I re-verified the
foreground-only primitive this spec depends on
(`lib/currentLocation.ts` — one-shot `getCurrentPosition`, coarse accuracy).
Background detection is new native infrastructure plus an iOS "Always" /
Android background-location consent flow. **It is out of scope here and this
spec does not depend on it.**

### The one rule everything else follows

**Being at a gas station is not evidence of a fuel purchase.** A renter may be
buying coffee, using the air pump, parking, or driving past. Therefore:

- GasCap **never** creates a `Fillup` from proximity. Proximity only ever
  opens a prompt.
- GasCap **never** fabricates gallons, dollars paid, price per gallon, fuel
  level, odometer or fuel grade. Every one of those comes from the receipt
  scan (reviewed) or the renter's own typing.
- The only things proximity itself may fill are **which station** and —
  subject to §5 — **the posted price**, because those are facts about the
  place, not about the transaction.

This is the standing "never invent a reading" rule applied to a new surface,
written out explicitly because a half-automated logger is exactly the shape of
feature that breaks it by accident.

---

## 2. Component and infrastructure reuse

Everything below already exists and is production-proven. **No new provider,
no new schema, no new persistence model, no new permission.**

| Need | Existing thing to reuse | Notes |
|---|---|---|
| Get the renter's position | `requestCurrentLocation(isNative)` — `lib/currentLocation.ts` | One-shot, `coarseLocation`, handles native (Capacitor) and web, returns `granted` / `denied` / `unavailable` / `timeout` / `unsupported`. Coordinates are never persisted. |
| Find nearby stations | `GET /api/fillups/nearby-stations?lat=&lng=` | Authenticated, **not Pro-gated**. Returns `{ available, stations }`, max 6, nearest-first. Returns `{ available: false, stations: [] }` with HTTP 200 when the maps provider isn't configured. The client already sends 3-decimal (~110 m) rounded coordinates and the server persists none. |
| Decide "are they actually AT this station" | `MAX_DISTANCE_MI = 0.5` + `haversineMi()` — `app/gas/report-price/route.ts` | The existing, shipped, battle-tested proximity gate for crowdsourced price reports. **Extract it to `lib/stationProximity.ts` and have both callers use it** rather than copying the constant. |
| Saved stations | `FavoriteStation` (`placeId`, `name`, `address`, `lat`, `lng`, `prices`, `priceUpdatedAt`) | A match here is a strong confidence signal — this is a station the renter chose to save. |
| Crowdsourced prices | `PriceReport` (`placeId`, `stationName`, `lat`, `lng`, `grade`, `price`, `createdAt`) | Corroborating/fallback price source. |
| Price freshness | `favoriteApplyMode()` / `freshestPriceTime()` — `lib/fuelPriceFreshness.ts` | `live` → one-tap apply; `last_known` → explicit accept required **whatever its age**; `unavailable` → no price. An unknown status is never treated as live. |
| Vehicle choice | `pickAutoSelectVehicle()` — `lib/vehicleAutoSelect.ts` (WS02 Phase 1) | Explicit default wins; sole eligible vehicle assumed; two or more with no default → the renter picks. |
| Receipt scan | `POST /api/fillups/scan` | **Pro-gated** (403 `upgrade: true`). Unchanged. |
| Receipt total → amount paid | `decideReceiptAmount()` — `lib/receiptScanAmount.ts` (WS02 Phase 1) | Already handles apply / confirm / skip and the self-disagreement cross-check. |
| The form itself | `components/FillupLogger.tsx` | Assisted Fill-Up **opens this**, prefilled. It does not reimplement it. |
| Persistence | `POST /api/fillups` → `lib/fillups.ts` | Unchanged. Including the 409 soft-warning / `force` confirm path and the free-tier cap. |
| Instrumentation | `POST /api/analytics/event` | Strict `CLIENT_EVENT_TYPES` allowlist, PII denylist, 2048-byte body cap, rate-limited. New events must be added to the allowlist — see §10. |

---

## 3. Trigger logic

**Entry point:** app open / return to foreground on the home route. No timer,
no polling, no background wake.

Evaluated in order; **any** failure means no prompt, silently:

1. **Opt-in is on.** Off by default. See §6.
2. **Signed in.** The station lookup requires a session.
3. **Not already mid-task.** Not in the fill-up logger, not in rental setup,
   not typing. (Mirror `decideAutoOpen()`'s "isn't typing" guard in
   `lib/rentalAutoOpen.ts`.)
4. **Not dismissed recently.** See §4's cooldown.
5. **A vehicle is available.** `pickAutoSelectVehicle()` returns non-null.
   With two or more vehicles and no default, prompt but ask which car — do
   **not** guess.
6. **Free-tier headroom exists.** A free account at its 5-logs-this-month
   ceiling must not be invited to log a 6th and then refused. Derive the
   month's count from the `GET /api/fillups` response the app already fetches;
   do not add an endpoint. At the cap, show nothing (an upsell triggered by
   standing near a gas station is the wrong tone).
7. **Location granted.** `requestCurrentLocation()` returns `granted`. A
   `denied` result turns the feature off and **never re-asks** — see §6.
8. **A station matched with sufficient confidence.** See §4.

### Cold-start cost

Steps 7–8 cost one geolocation call and one Places `searchNearby` call per
qualifying app open. Gate step 7 behind steps 1–6 so a user who can't or won't
use the feature never triggers either. Reuse the existing 30-minute nearby
cache where the position hasn't materially moved.

---

## 4. Station matching confidence

Three tiers. **Only the top tier may prompt without naming alternatives.**

| Tier | Condition | Behaviour |
|---|---|---|
| **High** | Nearest station ≤ 0.5 mi (the existing `MAX_DISTANCE_MI`) **and** either it is a `FavoriteStation` of this user, **or** it is ≥ 2× closer than the second-nearest | Prompt naming that station: *"Log a fill-up at Shell on Dean Rd?"* |
| **Ambiguous** | Two or more stations within 0.5 mi and none clearly nearest | Prompt **without** asserting one: *"Logging a fill-up? Pick your station"* + the candidate list. Never pre-select. |
| **None** | Nothing within 0.5 mi, `available: false`, or the lookup failed | **No prompt at all.** Not a degraded prompt, not a generic one — silence. |

Coordinates are rounded to ~110 m before leaving the device, which is coarser
than a forecourt. Two stations across an intersection are genuinely
indistinguishable at that resolution: that is precisely why the Ambiguous tier
exists and never pre-selects. **Do not raise GPS precision to resolve this** —
the privacy posture is worth more than the tap it saves.

**Dismissal and cooldown.** Dismissing is a real answer. Suppress for the
remainder of the day **for that station**, stored per-account on-device only
(the `gc_rental_autoopen:` pattern in `lib/rentalAutoOpen.ts`: namespaced by
user id so one person's dismissal never applies to whoever signs in next;
storage failures fail **off**, i.e. no prompt). Three dismissals in a row at
any station → stop prompting and surface the setting once, then never
again unprompted.

---

## 5. What gets prefilled, and how each field is labelled

| Field | Prefilled from | Label shown | May be wrong how? |
|---|---|---|---|
| Station name | Matched station | *"Detected — change if wrong"* | Wrong station at an ambiguous corner. Renter can change it; it's a free-text field today. |
| Vehicle | `pickAutoSelectVehicle()` | *"Your default vehicle"* / *"Your only saved vehicle"* | Renter is in a different car. Always changeable. |
| Price per gallon | Station price, **only** when `favoriteApplyMode()` says `direct` | *"Live price · updated {Google's observation time}"* | — |
| Price per gallon | `last_known` status | **Not prefilled.** Offered as *"Use last-known price ($3.49)?"* requiring an explicit tap, whatever its age | Posted price ≠ price paid (cash/credit split, loyalty, grade). It is a starting number, never an assertion. |
| Price per gallon | `unavailable` | Empty | — |
| Gallons | **Nothing. Ever.** | — | — |
| Amount paid | Receipt scan only, via `decideReceiptAmount()` | *"Read from your receipt — check it before saving"* | Already handled in Phase 1. |
| Date | Today | Normal editable field | — |
| Fuel grade | **Nothing**, unless a receipt scan read it | — | Grade drives the EIA comparison; guessing it corrupts the savings figure. |
| Odometer | Existing smart estimate, unchanged | Existing *confirm* treatment | — |
| Fuel level before | **Nothing.** The one field with no data source today | — | See `docs/`-level gauge-scan assessment; manual entry stays the path. |

**The price rule is the subtle one.** A station's posted price is a fact about
the station; what the renter paid is a fact about the transaction. Prefilling
the former into a field that means the latter is acceptable **only** labelled
as a live posted price, and only one tap from being changed. The existing
`live` / `last_known` / `unavailable` three-state model already encodes
exactly this and must not be bypassed for this surface.

---

## 6. Permissions, privacy, consent

- **Off by default.** Opt-in lives in Settings next to
  "Open my rental at pickup time", worded plainly: *"When I open GasCap near a
  gas station, offer to log a fill-up. Uses your location only while the app is
  open."*
- **Foreground only.** One-shot `getCurrentPosition` at coarse accuracy. No
  `watchPosition`, no background authorization, no native geofencing plugin,
  no continuous tracking. The first-run prompt must not imply otherwise.
- **No new permission request.** This is the same foreground location Find Gas
  already asks for. If the renter has already granted it, nothing new is
  asked.
- **`denied` is final.** Turn the setting off and do not re-ask. Re-prompting
  for a denied permission is how an app earns a permanent denial.
- **Nothing new is stored.** Coordinates stay in component state for that
  evaluation. Only the station **name** reaches the saved `Fillup`, exactly as
  "📍 Detect" does today.
- **Driver safety.** The prompt is passive and inline on the home screen —
  no modal that steals focus, no sound, no notification, nothing that could
  arrive while someone is moving. It is only ever rendered in response to the
  renter opening the app themselves.
- **The manual path is untouched.** "Log Fill-Up" in Tools works exactly as it
  does today, for everyone, whether or not this is enabled.

---

## 7. State handling and error handling

State is per-session and ephemeral; the only persisted state is the opt-in
flag and the per-station dismissal, both device-local.

```
idle → locating → matching → offered → { accepted → logger | dismissed }
                     ↓           ↓
                   silent      silent
```

| Failure | Behaviour |
|---|---|
| Location denied / unsupported | Setting off, no re-ask, silent |
| Location timeout / unavailable | Silent. Retry on the next app open, not in a loop |
| `available: false` (no maps provider) | Silent. Never an error toast — this is a config state, not a user problem |
| Nearby lookup non-200 or throws | Silent |
| No station within 0.5 mi | Silent |
| Price lookup fails | Prompt still shown, price field empty |
| Receipt scan 403 (free plan) | Existing upgrade copy, unchanged. The rest of the prefill still stands |
| Save rejected (409 soft warning) | Existing warning + `force` confirm path, unchanged |
| Save rejected (403 free cap) | Should be unreachable via §3 step 6; if reached, show the existing message |

**Every failure is silent.** A feature that guesses where you are has no
standing to interrupt you about failing to.

---

## 8. Data validation

No new validation layer. The prefilled values enter `FillupLogger` and face
exactly the checks a typed value faces today: `gallons > 0` and `price > 0`
before save, the server's own plausibility checks, and the 409 soft-warning
path. A prefilled price is not more trusted than a typed one.

One addition: **the station name must be length-capped and newline-stripped**
before it reaches the field, since it comes from a third-party API response.
The existing "📍 Detect" path already takes this same string from the same
endpoint, so this is a hardening of shared code, not a new risk.

---

## 9. Rollback

- **Kill switch:** one server-side flag, checked before any work, in the
  pattern of `GAUGE_SCAN_ENABLED` — a flag that returns early **before** any
  paid API call, so cached and old native clients can't keep spending.
  The native shells load the deployed web app, so flipping it needs no
  Codemagic rebuild.
- **Flag off ⇒ exact current behaviour.** No data written, nothing to undo,
  no migration to reverse. Any `Fillup` already saved through the assisted
  path is an ordinary `Fillup` and stays valid.
- **Staged rollout:** web first (instant revert), native after a full cycle
  of real use.

---

## 10. Logging and observability

New events, which **must be added to `CLIENT_EVENT_TYPES` in
`app/api/analytics/event/route.ts`** (the allowlist is the enforcement, not the
UI):

| Event | Metadata — bounded enums and booleans only |
|---|---|
| `assisted_fillup_offered` | `confidence: 'high' \| 'ambiguous'`, `hadLivePrice: boolean`, `vehicleSource: 'explicit-default' \| 'sole-vehicle' \| 'user-picked'` |
| `assisted_fillup_dismissed` | `confidence` |
| `assisted_fillup_accepted` | `confidence` |
| `assisted_fillup_station_corrected` | `confidence` — the renter changed the station we named. **The single most important accuracy signal in the feature** |
| `assisted_fillup_saved` | `pricePrefillUsed: boolean`, `receiptScanUsed: boolean` |

**No coordinates, no station name, no place id, no gallons, no price, no
dollar amount** — consistent with every existing event and with the PII
denylist that would reject them anyway. `assisted_fillup_station_corrected`
vs. `assisted_fillup_accepted` is the false-positive rate, measurable without
recording a single location.

---

## 11. Test coverage

The repository's test environment is `node` with no render harness, so the
established pattern is: **pure decision functions in `lib/`, exhaustively
tested; thin components that call them; source assertions for the wiring.**
That is how Phase 1 was built and how this should be.

Pure modules to extract and test:

| Module | Must cover |
|---|---|
| `lib/stationProximity.ts` (extracted from `report-price`) | Known distances, the 0.5 mi boundary exactly, antimeridian/pole sanity, invalid inputs. **Must be shown to give byte-identical results to the current `haversineMi` before `report-price` is switched to it** — the same parity-proof discipline as `calcTrip`'s extraction (`__tests__/calcTripParity.test.ts`). |
| `lib/assistedFillupTrigger.ts` | Each of §3's eight gates failing in isolation; the dismissal cooldown; storage throwing → no prompt |
| `lib/assistedFillupMatch.ts` | High / Ambiguous / None; the 2× nearest rule; a `FavoriteStation` match; ties; empty list; `available: false` |
| `lib/assistedFillupPrefill.ts` | `live` → prefilled; `last_known` → offered not prefilled, **at every age**; `unavailable` → empty; **gallons/level/grade never set under any input** |

**At least one test must assert the negative directly:** that no input to the
prefill layer — including a station with a complete, fresh price and a fully
specified vehicle — ever produces a gallons value, a fuel level, or a saved
`Fillup`. That is the invariant the whole feature rests on, and it should fail
loudly if someone later "improves" the prefill.

---

## 12. Open questions for Don

1. **Free or Pro?** The trigger, matching and prefill cost nothing marginal and
   my recommendation is **Free** — it is a convenience fix, and gating a
   convenience behind Pro is what made fill-up logging feel punitive before.
   The receipt scan inside it stays Pro, which is the real differentiator.
2. **0.5 mi, or tighter?** Reusing the proven constant is the conservative
   choice, but 0.5 mi in a dense strip can hold several stations, pushing more
   cases into Ambiguous. Tightening to ~0.15 mi would prompt less often and
   more accurately. I would ship 0.5 mi, measure
   `assisted_fillup_station_corrected`, and tighten on evidence rather than
   guess now.
3. **Prefill the posted price at all?** The honest argument against is that
   posted ≠ paid and a prefilled number is anchoring. The argument for is that
   it is labelled, one tap from changing, and already how the Find Gas → logger
   path behaves. I lean yes, for consistency — but this is a product call.
