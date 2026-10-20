# Workstream 02 — Smart Fuel Automation: Consolidated Report

**Status:** `CURRENT`
**Date:** 2026-10-20
**Author:** Claude Code
**Review:** requested from ChatGPT before any merge
**Authorization:** Don Parker. **Nothing here is merged or deployed.**

Sections 1–14 are the standing ChatGPT review packet format
(`docs/reviews/CHATGPT_REVIEW_PACKET_TEMPLATE.md`) covering the Phase 1 code
change. Appendices A–D are the Phase 2–6 analysis deliverables, which are
assessments rather than changes and so fall outside that template.

---

## 1. Objective

Reduce manual data entry in GasCap without new paid integrations. Specifically:
establish current repository truth; implement the four Phase 1 automation
improvements **only where inspection confirms they are still missing**; specify
an Assisted Fill-Up MVP; and assess gauge-photo scanning, connected-vehicle
providers, rental automation and how to measure any of it.

The brief states its own central premise as a hypothesis, and I am keeping it
one: excessive manual entry *may* contribute to low activation and conversion.
Nothing in this work tests that, and nothing here should be read as evidence
for it.

## 2. Repository State

- **Branch:** `feat/ws02-automation-phase1`
- **Base branch:** `main` @ `26f6cfa2cb902e5d78c24227d1e7db86e390e04c`
- **Review Target SHA:** `e7a62b2707d4f5e8ef5bf0b0064025eaffb2a1ee`
- **Packet Commit SHA:** differs from the above — this packet is itself a
  commit on the same branch, made after `e7a62b2`.
- **PR:** [dparker001/gascap#87](https://github.com/dparker001/gascap/pull/87)
- **Worktree:** `/Users/dpark/Projects/gascap-ws02`, created fresh off
  `origin/main` for this workstream.
- **Review this diff:** `git diff --name-status 26f6cfa...e7a62b2`

**One repository-truth note worth stating plainly:** the local `main` ref in
the primary checkout was **108 commits behind `origin/main`**. The Phase 5
audit's stated baseline (`26f6cfa`) was correct; the stale ref was local only.
Had I trusted the local ref I would have branched from 108-commit-old code and
"re-implemented" features that already shipped. Anyone starting work here
should `git fetch` and branch from `origin/main`, not from local `main`.

**Open work checked for conflicts:** PRs #85 and #86 (both Workstream 01,
both still open, both CI-green) touch conversion attribution and a diagnostic
CLI — **no file overlap** with this change. `git worktree list` holds 37 entries
(including this new one and the primary checkout); none holds uncommitted work
in the files this change touches. The primary
checkout has unrelated uncommitted work on `feat/rental-history-reminders`
which I did not disturb.

## 3. What I Found

Each Phase 1 item verified against `origin/main` before writing any code.

**A. Receipt OCR `totalCost` not applied — CONFIRMED, gap is real.**
`app/api/fillups/scan/route.ts` returns `totalCost`.
`components/FillupLogger.tsx` declared it in the response type at line 276 and
then never referenced it again: the applied fields were `gallons`,
`pricePerGallon`, `date`, `stationName`, `address` and `fuelGrade` only. The
"Amount actually paid" field existed and worked, purely by hand.

**B. Lone-vehicle auto-select — CONFIRMED, and worse than described in two
places.** `SavedVehicles.tsx` auto-applied only a vehicle with `isDefault`, so
a user with exactly one car got nothing. Not in the brief, found while
verifying it: `TripCostEstimator.tsx` auto-applied `vehicles[0]`, and
`getVehiclesForUser` orders by `createdAt` **ascending**
(`lib/savedVehicles.ts`), so a user who had explicitly starred their *second*
car still got their first. **The explicit default was already being
overridden** — that is a correctness bug, not just a missing convenience, and
it falls squarely inside item B's own stated requirement to preserve
explicitly selected defaults.

**C. Trip Planner ignores the active rental — CONFIRMED.** Rental mode offered
only `RENTAL_PRESETS` (11 class averages). `TripCostEstimator.tsx` contained
no reference to `RentalSession` at all, while the database held the real
year/make/model and `fuelTankCapacityGallons` for the car in the renter's
hands.

**D. Rental return-location autocomplete — ALREADY IMPLEMENTED. No change
made.** `components/rental-return/RentalLocationInput.tsx` has debounced
Google Places autocomplete via `/api/maps/autocomplete`, resolves a selection
through `/api/maps/place-location`, and is wired into all three rental entry
points (`RentalSetupFlow`, `QuickSaveRentalForm`, `EditRentalModal`) through
`RentalEventScheduleField`. It already satisfies the brief's own hardest
requirement here — *"prevent invalid or partially selected addresses from
being silently treated as verified"* — by invalidating coordinates and time
zone the moment the renter types, so free text never inherits a previous
selection's authority. The brief's `ReturnLocationInput` name is stale: it was
generalized to `RentalLocationInput` in the 2026-10-02 event-timezone work.
**Implementing this would have duplicated a working component.**

### Correction to the Phase 5 discovery audit

The brief warned not to conclude Quick Save is missing from a text search
alone. **The Phase 5 audit made exactly that error**, and it should be
corrected in the record rather than carried forward. It states:

> *"Reservation import / Quick Save — does not exist, contrary to the branch
> names suggesting otherwise. A direct search for 'QuickSave' / 'quick-save'
> across the entire codebase returned zero matches, and no `RENTAL_IMPORT_SPEC`
> or calendar-import file exists anywhere."*

On `main` @ `26f6cfa`, a case-insensitive search across `app/`, `components/`,
`lib/`, `__tests__/` and `docs/` returns **34 files**:
`lib/rentalQuickSave.ts`, `components/rental-return/QuickSaveRentalForm.tsx`,
`lib/rentalAddFlow.ts`, `lib/rentalCreateClient.ts`,
`components/rental-return/FinishSetupCard.tsx`, `app/rental-return/page.tsx`,
`app/api/cron/rental-return-reminder/route.ts`, `lib/rentalReturnTimeDefault.ts`,
`lib/rentalReturnLocation.ts`, **12 test files**, the help page and the AI prompt.
`docs/RENTAL_UPCOMING_IMPORT_SPEC.md`, `docs/RENTAL_QUICK_SAVE_PART_A_PLAN.md`
and `docs/RENTAL_CALENDAR_DISCOVERY_DESIGN.md` all exist. It shipped in PRs
#59 and #64.

The audit was almost certainly run with a case-sensitive search for the exact
string `QuickSave`, which the codebase spells `rentalQuickSave` /
`QuickSaveRentalForm` / `quick-save`. **Appendix C's rental assessment is
written against the code, not against that audit.**

## 4. What I Changed

| File | Purpose | Before | After |
|---|---|---|---|
| `lib/receiptScanAmount.ts` *(new)* | Decide what a receipt scan may do to "Amount actually paid" | — | Pure module: `normalizeReceiptCurrency`, `detectReceiptTotalConflict`, `decideReceiptAmount` → `apply` / `confirm` / `skip` |
| `components/FillupLogger.tsx` | Apply the scanned total | `totalCost` read from the response and discarded | Calls `decideReceiptAmount`; applies and labels, or asks, or leaves alone. Provenance tracked in refs (not state) so the decision isn't made against a stale closure if the renter types during the scan |
| `lib/vehicleAutoSelect.ts` *(new)* | One auto-select rule for every surface | — | `pickAutoSelectVehicle`: explicit default → sole eligible vehicle → null |
| `components/SavedVehicles.tsx` | Auto-apply a sole vehicle | Required `isDefault` | Uses the shared rule; the "nothing selected" guard is unchanged |
| `components/TripCostEstimator.tsx` | Fix garage auto-select; offer the active rental | `vehicles[0]`; rental mode = presets only | Shared rule for garage; the renter's own rental car offered above the presets, fetched from `GET /api/rental-sessions?status=active` |
| `lib/rentalTripVehicle.ts` *(new)* | Map a rental to Trip Planner vehicle data | — | `rentalTripVehicleFrom` / `rentalTripVehicleFor`; delegates "which rental" to the existing `selectPrimaryRental()` |
| `lib/translations.ts` | New copy | — | 7 keys × EN + ES |
| `app/help/page.tsx` | Required doc update | — | Receipt-scan FAQ expanded; default-vehicle FAQ covers the sole-vehicle case; new Trip Planner rental FAQ |
| `app/api/ai/chat/route.ts` | Required `APP FEATURES` update | — | Both behaviours described, including an explicit instruction that a rental's MPG is an EPA estimate, not a measurement |
| 3 test files *(new)* | Regression coverage | — | 63 tests |

## 5. Architectural Decisions

**Decision layers in `lib/`, not in the components.** All three behaviours are
pure functions the components call. Rejected alternative: inline the logic,
which is shorter. It loses because the test environment is `node` with no
render harness — logic inside a `.tsx` component is effectively untestable
here, which is exactly why `calcTrip` was moved to `lib/tripFuelPlanner.ts`.
It also satisfies the standing rule against domain logic in React components.

**One shared vehicle rule rather than fixing each surface.** Rejected
alternative: patch `SavedVehicles` for the sole-vehicle case and `TripPlanner`
for the default-ordering bug separately. It loses because they are the same
question, and two implementations are how they diverged in the first place.

**A rental's MPG is never stored or asserted.** `RentalSession` has no MPG
column. I did not add one and did not derive one from the tank size or the
vehicle class. The only MPG offered is an EPA lookup on year/make/model,
labelled an estimate, through the same `/api/mpg-lookup` the garage path uses.
Rejected alternative: fall back to a class-average MPG inferred from the
vehicle name — that is inventing a specification and reads as confirmed data
once it is in the field.

**`selectPrimaryRental()` reused for "which rental".** Rejected alternative:
take the newest active session (`createdAt desc`, what the API returns first).
It loses because Trip Planner would then be able to disagree with the
calculator banner about which rental is current, for the same user at the same
moment.

**The receipt total is surfaced, never reconciled.** When a scan's `totalCost`
disagrees with its own gallons × price, all three numbers are suspect and
GasCap cannot know which was misread. Rejected alternative: recompute the
total from gallons × price. It loses because it would overwrite a number
actually printed on the receipt with a derived one — inventing a reading in
the exact manner the engineering contract forbids.

**`'user'` provenance blocks an overwrite; `'receipt'` does not.** A second
scan replacing a first scan's value is what a renter retaking a photo
intends. A scan replacing what they typed is not.

## 6. Security Impact

**Security problems fixed:** none — this is not a security change.

**New security considerations introduced:**
- Trip Planner now reads `GET /api/rental-sessions?status=active`. That route
  is unchanged and ownership-scoped server-side via
  `getRentalSessionsForUser(userId)`. The client additionally captures the
  session user id before the fetch and discards a response that lands after a
  sign-out or account switch, so one person's rental can never render for the
  next person signed in on a shared device.
- `lib/receiptScanAmount.ts` treats the OCR payload as untrusted: the route
  types `totalCost` as `number | null`, but that is an assertion about
  `JSON.parse` output from a language model, not a guarantee. Strings, `NaN`,
  `Infinity`, negatives, objects and out-of-range values are all rejected
  rather than reaching `parseFloat` in the form.

**Remaining security concerns:** none identified in this change.

**Authentication / authorization behaviour changed:** **no.** Receipt scanning
remains Pro-gated at the route (403 `upgrade: true`); this changes only what
the client does with a response it was already receiving. Starting a rental
remains Pro-gated. No gate was added, removed, widened or moved. No client-side
check substitutes for a server one.

## 7. Data / Database Impact

**No database or production-data changes.** No schema change, no migration, no
`prisma db push`, no backfill, no script, no production read or write. No new
persistent store of any kind — in particular no new file-backed JSON store.
Every value either already existed in Postgres or lives in component state for
the life of a form.

## 8. User / Business Impact

**What customers notice:** a Pro receipt scan fills in the amount paid; a user
with one saved vehicle stops re-picking it; a user who starred a vehicle gets
*that* vehicle in Trip Planner; a renter planning a trip can select their
actual rental car instead of describing it as a class average.

**Pricing, plans, entitlements, trials, credits, giveaway entries, sweepstakes
eligibility, AMOE, rewards, email/SMS/push campaigns:** **untouched.** Nothing
in this change reads or writes a plan, an entitlement or an entry.

**Free vs Pro:** unchanged. Items B and C are available to everyone, which is
also my recommendation (see Appendix D) — they cost nothing marginal, and
gating a convenience is what made fill-up logging feel punitive before.

**Native:** web-only change. The native shells load the deployed web app, so
**no Codemagic rebuild is required** and no native config was touched.

**Backward compatibility:** every change is additive and degrades to today's
behaviour. No rental, no default vehicle, no scan, a malformed total, an
unconfigured maps provider, or the rental assistant disabled (404) all land
exactly where `main` lands today.

## 9. Testing Performed

```
npm test           →  3254 passed | 5 skipped (3259) across 187 files
npx tsc --noEmit   →  clean (exit 0)
npm run build      →  clean
npm run check:crons→  22 routes, 20 scheduled, 2 exempt
npm run check:sw   →  272/272 contract expectations hold
```

**New focused tests: 63**, in `__tests__/ws02ReceiptAmountPaid.test.ts` (27),
`__tests__/ws02VehicleAutoSelect.test.ts` (15),
`__tests__/ws02RentalTripVehicle.test.ts` (21). Coverage includes valid /
missing / malformed / conflicting OCR values; zero / one / many vehicles with
and without a default, ordering independence and ineligible vehicles; and
active / absent / incomplete / closed / broken-schedule rentals plus manual
override.

**Shown to fail against the old behaviour.** Reverting the four changed
component and translation files to `origin/main` (leaving the new `lib/`
modules and tests in place) and re-running gives **14 failed | 49 passed**.
Restoring them returns 63/63. Each test file also encodes `main`'s own logic
inline — `legacyApplyScan`, `legacyGarage`, `legacyTrip`,
`legacyRentalOptions` — and asserts it produces the wrong answer, so the gap
stays documented in the suite rather than only in this packet.

`__tests__/protectedPathGuard.test.ts` re-run after committing: 8/8 pass.

## 10. Files Changed

```
A	__tests__/ws02ReceiptAmountPaid.test.ts
A	__tests__/ws02RentalTripVehicle.test.ts
A	__tests__/ws02VehicleAutoSelect.test.ts
M	app/api/ai/chat/route.ts
M	app/help/page.tsx
M	components/FillupLogger.tsx
M	components/SavedVehicles.tsx
M	components/TripCostEstimator.tsx
A	lib/receiptScanAmount.ts
A	lib/rentalTripVehicle.ts
M	lib/translations.ts
A	lib/vehicleAutoSelect.ts
```

`public/sw.js` is regenerated by `npm run build` and left **uncommitted**,
matching every recent feature PR — the committed artifact is rebuilt in CI
before `check:sw` runs.

## 11. Known Risks / Remaining Questions

1. **No browser verification was performed.** Everything is proven by the test
   suite, `tsc` and a production build — no running app, no device. The UI
   additions (the confirm prompt, the mismatch note, the dropdown option) are
   asserted at source level, not rendered. A real Pro receipt scan against a
   real photo is **not** covered, because that path needs a live Anthropic key
   and a receipt.
2. **The receipt-conflict tolerance is a judgment call, not a measurement.**
   `max($0.50, 2%)` was chosen to absorb rounding and loyalty discounts without
   false-flagging large fills. I have no corpus of real receipts to calibrate
   it against. Too tight is a nag; too loose misses a real misread. It is one
   constant, easy to change.
3. **An EPA MPG for a rental may be the wrong trim.** `RentalSession` stores a
   trim but my lookup sends year/make/model only, so EPA averages across trims.
   This is identical to the garage path's behaviour when `epaId` is absent, and
   it is labelled an estimate — but a renter in a V6 getting a 4-cylinder's
   figure is a real inaccuracy. Using the trim would need an `epaId` resolution
   step the rental flow does not have today.
4. **The EV case is untested here.** An electric rental has no gallons and an
   EPA lookup would return MPGe; `comb08`/`range` for a BEV is the documented
   nonsense-tank-size trap. In practice such a rental has no
   `fuelTankCapacityGallons`, so the offer appears with tank empty and MPG from
   an MPGe figure. **I did not add an EV guard and I think one is warranted** —
   flagged rather than silently shipped.
5. **Process mistake made and corrected:** my first conflict-detection test
   asserted `12.004 × 3.499 = 42.01`. It is `42.00`. The test failed, the
   implementation was right, and I corrected the fixture — worth recording
   because the failure mode (trusting hand arithmetic in a test fixture) is how
   a wrong expectation gets "fixed" by changing correct code.
6. **Not verified:** whether a `FavoriteStation`-style ordering guarantee makes
   `vehicles[0]` load-order-stable in any other surface I did not inspect. I
   fixed the two auto-select call sites I found; I did not audit every consumer
   of the garage list.

## 12. Claude's Assessment

**READY FOR REVIEW.** All gates pass, the regression tests are shown to fail
against the old behaviour, no security/payment/entitlement/schema surface is
touched, and the one item that turned out already built (D) was left alone.
Not ready to *merge* without Don's authorization, and I would want a decision
on risk 4 (the EV guard) first.

## 13. Questions for ChatGPT

1. `lib/receiptScanAmount.ts` surfaces a scan that disagrees with itself but
   still applies the receipt's own total. Is there a case for applying
   **nothing** when the cross-check fails, rather than applying the printed
   total with a warning?
2. Provenance lives in two refs (`amountPaidRef`, `amountPaidSourceRef`) kept
   in sync by a single `writeAmountPaid` writer, because the decision happens
   after an `await` and a state closure would be stale. Is there a path where
   they can still desynchronize from the rendered `amountPaid`?
3. `pickAutoSelectVehicle` treats a vehicle with `gallons <= 0` as ineligible
   **even when the user explicitly starred it**, on the grounds that it cannot
   drive a calculation. Is honouring the user's star the better default, given
   the schema makes `gallons` required?
4. Trip Planner drops a rental response whose captured user id no longer
   matches. Is capturing `session.user.id` at fetch time sufficient, or should
   it also re-check immediately before `setActiveRental`?
5. On risk 4: should the active-rental offer be suppressed outright for a
   rental with no `fuelTankCapacityGallons` whose EPA lookup suggests a BEV, or
   is labelling it an estimate enough?
6. Appendix A argues the gauge-scan shelving decision rests on no recorded
   measurement and that `lib/gaugeGeometry.ts` has zero test coverage. Is the
   non-linearity objection there fatal to the feature, or an acceptable error
   band for a confirm-only reading?

## 14. Requested Review Scope

**Most scrutiny, in order:**

1. **`lib/receiptScanAmount.ts` and its wiring** — it writes a dollar amount
   into a financial field from a language model's output. The provenance
   mechanism that stops it overwriting a user's own figure is the part worth
   attacking.
2. **The account-scoping of the rental fetch in `TripCostEstimator.tsx`** —
   cross-account data leakage on a shared device is the only way this change
   could cause real harm.
3. **`lib/rentalTripVehicle.ts`'s refusal to invent an MPG**, and whether the
   EV case (risk 4) needs a guard before merge.

**Needs little scrutiny:** `lib/vehicleAutoSelect.ts` (71 lines including its
rationale comment; one pure 10-line function, exhaustively tested), the
translation additions, and the doc updates.

---
---

# Appendix A — Phase 3: Gauge-photo scanning feasibility

**Verified against code, not recalled.** `app/api/gauge/scan/route.ts` and
`lib/gaugeGeometry.ts` both still exist and are intact.
`GAUGE_SCAN_ENABLED = false` in **two** places — the route (line 71, returning
503 before any Anthropic call) and `components/TargetFillForm.tsx` (line 34,
hiding the button). **It remains disabled. I did not change either flag.**

## How it works

A two-stage pipeline that is genuinely better designed than "ask a model for a
percentage":

1. Claude Vision **locates landmarks** — `pivot`, `needleTip`, `empty`,
   `full` — in normalized image coordinates, plus a gauge-type
   classification, an image-quality verdict, and its own independent holistic
   percentage guess.
2. `computeGaugePercent()` derives the percentage **in code** from the
   needle's angle along the E→F arc, aspect-corrected. The model is asked to
   do what it is good at (locating) and explicitly told not to do the ratio
   arithmetic.
3. A self-consistency check compares the geometric answer to the holistic
   guess; disagreement over `CROSS_CHECK_TOLERANCE = 12` points drops
   confidence to 20–50 and sets `retakeRequired`.

## Why it was shelved

Commit `b9a05c0` (2026-07-09): *"Even with the geometry pipeline … reads
aren't reliable enough to keep in the app."* It was the **second** shelving —
`fe44e83` disabled an earlier holistic-only version to stop token spend, and
`28b8b3c` re-added it with the geometry pipeline in between.

**The decision records a conclusion but no measurement.** No accuracy figure,
no test set, no error distribution, no sample size appears in the commit, in
`docs/`, or anywhere in the repository. That is the single most important fact
for a re-enable decision: **there is no baseline to improve on.** Any claim
that accuracy is now "good enough" would be measured against nothing.

## Four specific technical findings

**1. `lib/gaugeGeometry.ts` has zero test coverage.** No test file imports
`computeGaugePercent`, `angleAround` or `norm180`. The eight `gauge*` test
files all cover gauge *styles* — the visual dial the user drags — not this
module. The deterministic step the entire accuracy argument rests on has never
been unit-tested. This is cheap to fix and should be fixed regardless of
whether the feature is ever re-enabled.

**2. The linearity assumption is a physical limitation, not a software one.**
`computeGaugePercent` maps needle angle to fuel fraction **linearly**:
`frac = (needleAngle − emptyAngle) / (fullAngle − emptyAngle)`. Real automotive
fuel gauges are not linear. Float-arm sender geometry, deliberate
manufacturer damping, and irregular tank shapes produce the familiar
"first quarter lasts forever, last quarter drops fast" behaviour. **A perfectly
located needle still does not give a true fuel fraction.** No improvement in
the vision model touches this. It is, in my assessment, the dominant error
term and the real reason the feature never felt trustworthy — and it is not
written down anywhere in the code.

**3. The cross-check is not independent.** The landmarks and the holistic
percentage come from **the same model, the same image, the same call, the same
context window**. Those errors are correlated: a confidently mislocated needle
will tend to come with a confidently wrong holistic estimate that agrees with
it. Agreement therefore overstates confidence, and the pipeline's main safety
mechanism is weaker than it looks. A genuinely independent check would need a
second call that is not shown the first one's answer — doubling the token cost.

**4. Out-of-range needles are silently clamped.** `frac` is clamped to `[0, 1]`,
so a needle located below E or above F — a strong signal of mislocation —
becomes a confident 0% or 100% rather than a flag. 0% and 100% are also the two
answers with the largest consequences.

Two smaller notes: the route calls `claude-sonnet-5`, which is **not** the
current generation (Sonnet 5.5, Opus 5.5, Haiku 5.5 and Fable 5.1 are), while
the receipt scanner uses `claude-opus-4-5` — so neither is current. And
`needsUserConfirmation` is `retake || confidence < 80`, and the analog happy
path reaches 94, so a high-agreement read would **not** require confirmation
today. For any re-enable, confirmation must be unconditional.

## Assessment

**Not re-enablable on current evidence, and the blocker is not what it looks
like.** The vision stage can probably be improved cheaply by moving to a
current model. The linearity problem cannot be improved at all without
per-vehicle gauge calibration data GasCap does not have and has no way to get.

**An AI-interpreted gauge image must never be treated as a sensor
measurement** — it is a photograph of an instrument that is itself an
approximation.

**If Don wants this re-examined, the cheapest honest path, in order:**

1. **Unit-test `lib/gaugeGeometry.ts`** — synthetic landmark sets with known
   angles, the 20° minimum-sweep rejection, aspect correction, the clamp, and
   degenerate inputs. Zero cost, zero risk, useful whatever is decided.
2. **Build a labelled test set.** 30–50 photos of real gauges with the true
   level known independently (immediately-after-fill, or
   gallons-added-against-known-capacity). Without this there is nothing to
   measure.
3. **Re-measure on a current model**, unchanged pipeline. This isolates
   "the model was weak" from "the method is wrong".
4. **Quantify the non-linearity** on that same set: compare geometric output
   to true level. If the residual error is large and systematic, the method is
   the ceiling and the feature should stay shelved permanently — which would
   be a genuinely useful answer.

**Re-enabling in production is explicitly outside this assignment and I have
not done it.** My recommendation is that steps 1–2 are worth doing and step 3
should not begin before step 2 exists.

---

# Appendix B — Phase 4: Connected-vehicle integration

The Phase 5 audit (§B4) already did this comparison thoroughly — Smartcar vs.
High Mobility vs. direct manufacturer APIs, coverage, freshness, pricing,
consent, and the two removal episodes with their commit-record reasons. Per
the brief's instruction not to repeat completed research, **I am not
re-deriving it.** I verified the two load-bearing claims:

**The V3 code is genuinely recoverable.** SHA `17ee3a0` exists and is a valid
commit (*"migrate GasCap Connect to Smartcar V3 client_credentials flow"*). It
contains nine Smartcar files: `lib/smartcar.ts`, five routes under
`app/api/smartcar/` (connect, callback, status, sync, disconnect), a debug
config route, and two SQL migration files. **Nothing Smartcar-related exists
on current `main`** — the schema no longer reflects those migrations.

**The economics are unchanged and still decisive.** Smartcar's Build tier
starts at **$1.99/vehicle/month** against a **$2.99/month** subscription —
roughly two-thirds of the revenue from a Monthly subscriber, before the
separate carmaker connected-services plan many brands require of the user
(Toyota ~$80/yr, OnStar $14.99/mo, Kia ~$149/yr). That is the same arithmetic
that killed the May 2026 attempt, and confirmed paid volume today is
approximately one customer.

**Recommendation: wait. Do not commit to a paid build.** Agreeing with Phase 5.
At current volume no per-vehicle recurring cost clears the bar, and High
Mobility has no US consumer offering at all.

**On the free-tier read-only test the brief asks about:** yes, it is
technically possible — Smartcar's free tier covers one real vehicle, and
`17ee3a0` is recoverable, so a zero-cost read-only smoke test against Don's
own authorized vehicle could settle the unresolved June credential question
and measure real data freshness. **I have not done it** and it needs separate
approval: it touches external service credentials, which this assignment
explicitly excludes.

One thing to fix **before** any revival, from the Phase 5 audit and worth
repeating because it is a contract violation waiting to happen: the old sync
code did `fuelData?.percentRemaining ?? v.fuelLevel`, silently keeping a stale
reading when a read failed. That is inventing a reading. It must not be
ported forward.

---

# Appendix C — Phase 5: Rental automation

**Written against the code on `main` @ `26f6cfa`, not against the Phase 5
audit's rental section, which §3 above corrects.**

## What already exists (do not rebuild any of this)

| Capability | Where | State |
|---|---|---|
| Agreement-photo / PDF scan → prefills the whole setup wizard | Setup step 1, Claude vision | **Shipped.** Extracts company, agreement and confirmation numbers, vehicle, return time, return location, per-gallon fuel rate. Pro-gated; manual entry always works |
| Quick-save an upcoming reservation | `lib/rentalQuickSave.ts`, `components/rental-return/QuickSaveRentalForm.tsx` (12 test files) | **Shipped** (PRs #59, #64). Company + optional confirmation number + pickup/return location and time; car, tank and fuel deliberately left blank |
| Finish-setup-at-the-counter checklist | `components/rental-return/FinishSetupCard.tsx` | **Shipped.** Car → tank → pickup fuel, in order. Until done, fuel reads *unknown* and the calculators explain why rather than guessing |
| Time-aware lifecycle | `lib/rentalCalculations.ts`, `lib/rentalPresentation.ts` | **Shipped** (C1). Derived, never stored; `selectPrimaryRental()` is the shared "which rental is current" |
| Per-event time zones | `lib/rentalTimezone.ts`, `RentalLocationInput` | **Shipped.** Pickup and return each carry their own IANA zone; one-way cross-zone rentals supported |
| Return/pickup location autocomplete | `RentalLocationInput.tsx` | **Shipped** — this is Phase 1 item D |
| Rental history + read-only past-rental detail | `app/rental-return/history` | **Shipped** (PR #57) |
| Provider abstraction for Level 2 | `lib/rentalProvider.ts`, `docs/RENTAL_INTEGRATION_LEVEL2.md` | `ManualRentalDataProvider` implemented; Level 2 providers stubbed in the registry, unimplemented |
| Trip Planner prefill from an active rental | `lib/rentalTripVehicle.ts` | **This PR** |
| Email/calendar reservation import | `docs/RENTAL_UPCOMING_IMPORT_SPEC.md` | **Spec only, deliberately not built.** The AI prompt already instructs the assistant not to claim GasCap imports bookings from email |

## The one thing that genuinely needs a partner

**Fuel-level readings.** Pickup, current and return fuel all come from the
renter's own observation of a gauge, which the architecture's own documented
precedence order ranks **last**: rental-company data > vehicle telematics > a
verified rental document > manual exact gallons > manual percentage > manual
gauge estimate. `VEHICLE_TELEMATICS` and `RENTAL_COMPANY_API` are already
first-class `FuelDataSource` values with their own non-estimated display
treatment — `formatGallons()` omits the `~` prefix a manual estimate gets.
**The display layer is Level-2-ready today; it simply has nothing but manual
sources feeding it.** Authoritative return odometer is the same story.

## Near-term opportunities, no partner needed

1. **Point the existing agreement scanner at a forwarded confirmation email or
   an `.ics` invite.** Highest leverage by a distance: same model, same
   extraction schema, different input channel. The spec already exists
   (`docs/RENTAL_UPCOMING_IMPORT_SPEC.md`). The new surface is inbound email
   parsing, which is a real security consideration and the reason it should get
   its own review rather than being folded into a convenience PR.
2. **Trip Planner prefill — done in this PR.**
3. **Reuse the rental's vehicle identity to resolve an `epaId`**, which would
   fix risk 3 above (trim-averaged MPG) and improve the rental dashboard's own
   estimates at the same time.
4. **Document the fuel-measurement hierarchy where renters can see it.** The
   precedence order exists in a design doc and in `formatGallons()`'s `~`
   prefix, but a renter disputing a fuel fee does not read either. This is a
   copy change, not an engineering one.

## What a partnership would need to supply

Reservation id, vehicle identification (VIN preferably), pickup and return
location, pickup and return timestamps, **fuel readings at pickup and return**,
odometer at both, and any refuelling charge applied. Of these, everything
except the fuel and odometer readings is **already obtainable today** from the
agreement scan or the renter. That is worth being precise about in any
partnership conversation: GasCap needs exactly two things it cannot get
itself, and they are the two that decide a fuel-fee dispute.

**No rental company was contacted and no external integration was initiated.**
Per the standing rule, no Hertz/Avis/Enterprise implementation without approved
credentials and a written spec.

---

# Appendix D — Phase 6: Measuring whether any of this works

**Coordinated with Workstream 01, not redesigned.** WS01 owns conversion
measurement; `/api/analytics/event` already exists with a strict
`CLIENT_EVENT_TYPES` allowlist, a PII denylist, a 2048-byte body cap and rate
limiting. Nothing here proposes new measurement infrastructure.

## What can and cannot be tested

WS01 Phase 4 established the true baseline at roughly **1 confirmed organic
purchase**. Therefore, stated plainly:

**Cannot be tested now, at any sample size this feature will produce:** paid
conversion, trial-to-paid rate, revenue per user, or any purchase outcome.
**Do not claim a conversion improvement from this work.** The honest statement
available is about effort and engagement, not money.

**Can be tested now:** fill-up completion rate; median time to complete a
fill-up; **number of fields the user typed by hand** (the most direct measure
of the thing this workstream actually changes); abandoned fuel-entry sessions;
second fill-up within 30 days; 7- and 30-day retention; Pro-offer view and
click rate; and — specific to automation — **the error rate**:
`assisted_fillup_station_corrected` vs `assisted_fillup_accepted`, receipt
totals the user overrode, and dismissal rate.

## Recommended design

**Control:** today's manual fill-up flow. **Test:** the Appendix-free Phase 1
prefills now, and later the Assisted Fill-Up MVP
(`docs/WS02_ASSISTED_FILLUP_MVP.md`) behind its kill switch.

The Phase 1 changes shipped in this PR are **not** an experiment — they are
unconditional improvements and splitting traffic to measure them would be
withholding a fix to learn something small. What they *do* give is a
before/after on manual-fields-typed, which is worth capturing. The Assisted
Fill-Up MVP is the one that warrants a real control group, because it can be
wrong in a way manual entry cannot: it can name the wrong station.

**Primary metric: manual fields entered per completed fill-up.** It moves
immediately, it needs no purchase volume, and it is the literal thing the
workstream is for. Retention is the secondary metric and will take months.

## Free vs Pro packaging

**No entitlement change is proposed and none was made.** On evidence, my
recommendation for later:

- **Free:** everything with zero marginal cost — the lone-vehicle auto-select,
  the Trip Planner rental prefill, the Assisted Fill-Up trigger and station
  matching. These are convenience fixes, and gating convenience is what made
  logging feel punitive before.
- **Pro, as today:** anything with a real per-use cost — receipt OCR, the
  agreement scan, and any future gauge scan. These are the honest
  differentiators because they genuinely cost money to run.

That split is a recommendation for Don's decision, not a change.

---

# Decisions requiring Don's approval

| # | Decision | My recommendation |
|---|---|---|
| 1 | Merge PR #87 to `main` (a production deploy) | After ChatGPT review and a decision on #2 |
| 2 | Add an EV guard to the active-rental Trip Planner offer (risk 4) | **Yes** — suppress or clearly mark a rental with no tank size whose EPA data suggests a BEV |
| 3 | Build the Assisted Fill-Up MVP per `docs/WS02_ASSISTED_FILLUP_MVP.md` | Worth building; it is the highest-leverage item in the workstream and needs no new provider |
| 4 | Assisted Fill-Up: Free or Pro? | **Free** (the OCR inside it stays Pro) |
| 5 | Assisted Fill-Up proximity radius: 0.5 mi or tighter | Ship 0.5 mi, measure station corrections, tighten on evidence |
| 6 | Unit-test `lib/gaugeGeometry.ts` | **Yes** — cheap, useful regardless of the feature's fate |
| 7 | Build a labelled gauge test set before any gauge-scan re-measurement | **Yes**, and do not re-measure before it exists |
| 8 | Re-enable gauge scan in production | **No** — not on current evidence |
| 9 | Zero-cost read-only Smartcar free-tier test on Don's own vehicle | Optional. Settles the credential question; no commitment implied |
| 10 | Commit to a paid connected-vehicle integration | **No** — the economics have not changed since May 2026 |
| 11 | Build rental reservation import by forwarded email | Worth doing, but as its own reviewed PR — inbound email parsing is a new security surface |
| 12 | Phase 6 primary metric = manual fields entered per fill-up | **Yes**, and explicitly do not claim a paid-conversion effect |

**STOP.** No merge, no deploy, no schema change, no paid integration, no
customer-facing launch without Don's explicit authorization.
