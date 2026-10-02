# ChatGPT Review Packet — Rental Quick-Save, Part A (A1–A8)

## 1. Objective
Don approved design rev 2 and asked Claude to implement Part A (A1–A8) test-first on `feat/rental-quick-save` and stop at READY FOR REVIEW. Two final instructions:
1. **Refuel with an unknown current level** must not compute from zero or establish a level. The renter must give a post-refuel reading or confirm full. The refuel record is kept.
2. **Tank-clear protection** must live in the server/domain layer:
   - preserve a raw gauge/percent observation if the model stores it independently;
   - null capacity-derived gallons;
   - keep absolute gallons;
   - never derive gallons without a capacity.
   If the raw observation can't be preserved, **reject** `value → null` when such readings exist. Covered by server-level tests, since `/api/rental-sessions/[id]` now accepts an explicit null tank.

Part B: only add a key-rotation note to the design. No schema, Cloudflare, Railway-secret or production change.

## 2. Repository State
- **Branch:** `feat/rental-quick-save` (local, **not pushed**), worktree `/Users/dpark/Projects/gascap-quick-save`
- **Review Target SHA:** `82974b6` (last code/test commit, A7)
- **Packet Commit SHA:** the commit after `82974b6` that adds this file and relabels the plan/spec status (docs only)
- **Base branch:** `main` @ `eb7ef00` (PR #58 merge). The branch also carries the design docs commits `c66d9f5…0e826cb` from `docs/rental-import-spec`.
- **Relevant PR:** none yet (opening one awaits Don's go-ahead)
- **Review this diff:** `git diff --name-status origin/main...82974b6` (§10)

Commits on top of `main`:
```
82974b6 docs/copy: Help + APP FEATURES for rental quick-save                       (A7)
fcfbafe fix(rental): Part A copy — finish-setup pickup reminder, schedule labels    (A6)
b685e83 feat(rental): quick-save an upcoming rental (second entry point)            (A4)
40d30a1 fix(rental): unknown stays unknown; setup order; Finish setup card          (A2+A3+A5)
8bb5b45 fix(rental): tank-capacity transitions + no gauge/percent without a tank    (A1)
0e826cb docs: Part B — document HMAC token key-rotation procedure for B1 review
1a53f53 docs: Part A implementation plan — rental quick-save
bac3c68 docs: rental import spec rev 2 — ChatGPT design review conditions
a4ae82d docs: ChatGPT review packet — rental quick-save + email import spec
790d9f3 docs: record Don's decisions on rental import spec
c66d9f5 docs: PLANNED spec — quick-save upcoming rentals + email booking import
```

## 3. What I Found
Beyond the defects the design review already named:

1. **The model cannot preserve a raw gauge/percent observation independently.**
   - `RentalSession` stores `pickupFuelGallons` / `currentFuelGallons` plus a source (`MANUAL_GAUGE` / `MANUAL_PERCENT`). There is no fraction column.
   - Per Don's fallback rule, `value → null` is therefore **rejected (422)** while such a reading exists.
2. **New latent defect: `value → different value` for a `full` target.**
   - The old reconcile only *clamped* the target, so 14 → 18 gal kept "full" at 14 and 18 → 12 clamped to 12 (correct only by accident).
   - Fixed in A1: a `full` target follows the new capacity.
3. **New defect: Prepare for Return treated an unknown target as 0.**
   - `gallonsNeeded(session.requiredReturnFuelGallons ?? 0, confirmedGallons)` produced a green "at or above target" verdict whenever the target was unknown.
   - Reachable case: same-as-pickup with no pickup level, but a confirmed current level.
   - Fixed in A2.
4. **The live refuel path is `lib/rentalFillups.ts`, not `logRefuel`.** `logRefuel` is a frozen legacy function. The live raw SQL did `COALESCE("currentFuelGallons", 0) + gallons`. Fixed there. Legacy `logRefuel` is unchanged and not called by any route.
5. **Saving a pickup reading always overwrote the current reading**, even after a refuel or an independent current reading. It now seeds current only if nothing has happened since pickup.
6. **No path to record a current level when it is unknown.** The update control only rendered when a reading already existed. Added "Record current fuel level" for in-progress rentals.
7. **The untouched rental gauge drew an "E" needle with "≈ 0.0 gal".** Seen in the PR #58 smoke test.
8. **The protected create route needed no change.** It already maps `RentalScheduleError` to `{error: code, field}` with that error's status, so the new 422 fuel codes flow through untouched.

## 4. What I Changed
**A1 — `lib/rentalCalculations.ts`, `lib/rentalSessions.ts`, `app/api/rental-sessions/[id]/route.ts`**
- New pure `reconcileForTankCapacityChange()` covering all three transitions. Explicit same-request values always win.
  - `null → value`: absolute readings clamp; a `full` target becomes the capacity (was stuck null).
  - `value → value`: gauge/percent rescale (unchanged); absolute readings clamp; a `full` target follows the new capacity (was clamp-only).
  - `value → null`: **refused**, `422 {error:'tank_clear_would_discard_reading', field:'fuelTankCapacityGallons'}`, if any non-explicit pickup/current reading is gauge/percent-sourced. Otherwise the `full` target becomes null, same-as-pickup follows the absolute pickup, `exact` is kept, and absolute gallons are kept.
- **Invariant: no gauge/percent reading without a capacity.**
  - `422 {error:'tank_capacity_required', field}` on create (domain), update (domain), and the confirm-fuel PATCH path (route, since that write bypasses `updateRentalSession`).
  - `RentalScheduleError` widened with these two codes (status 422).
- PATCH accepts `fuelTankCapacityGallons: null`. Non-numeric, zero or negative values → 400.

**A2 / A3 / A5 — one commit (`40d30a1`)**
- `lib/rentalFillups.ts` SQL:
  - unknown current → stays NULL, with source and `currentFuelUpdatedAt` untouched;
  - known current → unchanged behaviour (add, clamp, `RECEIPT`, timestamp);
  - the Fillup row is still created.
- `lib/rentalSetupState.ts` (new, pure): `rentalSetupSteps`, `setupIncomplete`, `fuelInputMethodsFor`, `pickupSaveAlsoSetsCurrent`, `returnTargetKnown`.
- `RentalDashboard.tsx`:
  - tank bar only for a real current reading;
  - Prepare for Return shows "return target unknown" instead of computing against 0;
  - "Record current fuel level" plus a note after a fill-up when the level is unknown;
  - pickup-fuel card hidden until a tank exists;
  - Add Fuel without a tank shows "finish setup first";
  - pickup save seeds current only per `pickupSaveAlsoSetsCurrent`;
  - `FinishSetupCard` rendered while setup is incomplete.
- `FuelLevelInput.tsx`: gauge/percent methods only with a tank; otherwise gallons only, with a hint.
- `FuelGauge.tsx`: optional `unset` prop (default `false`, so the main calculator is unchanged). Shows "not set" and hides "≈ x gal" until the user touches it.
- New `FinishSetupCard.tsx`: car → tank → pickup fuel, with the next step highlighted and pickup locked until a tank exists.

**A4 — `lib/rentalQuickSave.ts`, `QuickSaveRentalForm.tsx`, `app/rental-return/page.tsx`**
- A "Booked ahead? Save it as upcoming" button for Pro users beside "+ New Rental". The full wizard is unchanged.
- Fields: company, optional confirmation number, and pickup + return via `RentalEventScheduleField`.
- Rules:
  - pickup date/time is **required**;
  - each time must resolve in a zone (stricter than the wizard: a zoneless time would save with no reminders);
  - a DST gap is blocked;
  - a fall-back occurrence choice is sent.
- Posts to the existing `POST /api/rental-sessions`. The payload never contains vehicle, tank, fuel, rate, photo or UTC fields.

**A6 — copy (EN/ES)**
- **Cron pickup2 copy (approved):** when the car or tank is missing, the email/push say to finish setup at the counter, with CTA "Finish setup →".
  - The subject, query, window, tier, dedup, stamp and link are unchanged.
  - `findMany(include)` already returns the setup fields, so no query change was needed.
- **Open-rental Rental Details:** "Pickup / Return". The completed view keeps "Picked Up / Returned".
- **Zone-difference line:** "behind your" / "ahead of your" (was "behind of").

**A7 — `app/help/page.tsx`, `app/api/ai/chat/route.ts`**
- New Help FAQ and APP FEATURES bullet.
- APP FEATURES explicitly says email import is **not** available yet.

**Docs:** the Part A plan is relabelled IMPLEMENTED (pending review); the spec says Part A is implemented on the branch and Part B remains PLANNED. Part B has a key-rotation procedure note (`0e826cb`).

## 5. Architectural Decisions
- **Reject rather than discard on `value → null`.** This is Don's fallback rule, chosen because the model has no fraction column. Adding one would be a schema change, which Part A excludes.
- **The invariant is enforced at the domain layer *and* in the PATCH route.** The confirm-fuel write intentionally bypasses `updateRentalSession`, so the route check is required. The domain check protects create and update for any caller.
- **The tank change is the only trigger for target recomputation.** A policy change without a tank change keeps existing behaviour (out of scope).
- **The refuel fix is in the atomic SQL itself**, not a JS pre-check. That keeps the 2026-08-25 lost-update guarantee: a single `UPDATE` whose SET expressions all read the pre-update row.
- **Quick-save is stricter than the wizard about zones.** Its purpose is reminders, and a zoneless time silently produces none.
- **Pure helpers (`rentalSetupState`, `rentalQuickSave`)** keep the "never invent" decisions unit-testable instead of depending on source-text guards alone.
- **The cron chooses copy from fields already loaded.** No query or selection change keeps the "copy only" approval literal.

## 6. Security Impact
- **New input accepted:** `PATCH /api/rental-sessions/[id]` accepts explicit `null` for the tank. It is validated (null or finite > 0) and ownership-scoped like every other field. It cannot discard a gauge/percent observation (422).
- **New 422 responses carry only a code and field name.** No data leaks.
- **Protected create route** (`app/api/rental-sessions/route.ts`) is unchanged, including its Pro gate. Quick-save goes through it.
- **No auth, entitlement, secret or webhook change.**

## 7. Data / Database Impact
- No schema change, migration, backfill, or production-data change.
- **Behaviour change on writes:**
  - a refuel onto an unknown current level now leaves it NULL (previously it wrote the gallons added);
  - clearing a tank can now be refused;
  - a first-time tank or a tank change now recomputes a `full` target.
- **Existing rows:** every existing row has a tank (the wizard required one), so the `null → value` path only affects quick-saved rentals going forward.

## 8. User / Business Impact
- **Renters can save a booking in about a minute** and finish at the counter, with a checklist instead of guessed numbers.
- **Removed: two misleading states.**
  - A green "at or above target" verdict with an unknown target.
  - An "E / ≈ 0.0 gal" gauge before any reading.
- **Reminders:** the pickup reminder tells quick-saved renters what to do at the counter. Timing is unchanged.
- Pro gating is unchanged (starting a rental requires Pro; quick-save is a way to start one).

## 9. Testing Performed
Run at `82974b6` in the worktree:
```
npm test          → 2062 passed / 2062 (128 files)
npx tsc --noEmit   → exit 0
npm run build      → exit 0 (regenerated public/sw.js + workbox restored/removed; tree clean)
```
- **Focused:** 451/451 across 17 files. These are the new Part A suites plus the rental timezone/reminder, confirmation-gate, trip-fill, calculations, protected-path guard (8/8) and CR-1 suites.
- **Regression tests shown failing on the prior code before each fix:**
  - `rentalTankCapacityTransitions.test.ts`: 13/20 failed on the old code (server-level, through the real PATCH route and real domain layer, in-memory Prisma).
  - `rentalFillups.test.ts` SQL test: failed on the `COALESCE(...,0)` SQL.
  - `rentalSetupState.test.ts`: 4 wiring tests failed before the dashboard/gauge changes.
  - `rentalQuickSave.test.ts`: 2 wiring tests failed before the form and page.
  - `rentalReturnReminderCron.test.ts`: 2 new incomplete-setup copy tests failed before the copy change.
  - `rentalPartACopy.test.ts`: 3 failed before the label/grammar fixes.
- **Existing guards updated (4), each asserting the same property in the new code shape:**
  - `rentalFuelConfirmationGate.test.ts`: confirmed-value calculator; awaited pickup/current save (new dependency list); `RECEIPT` on a known bump.
  - `rentalTripFillCalculator.test.ts`: Add Fuel tank gate.
- **Not performed:**
  - **Live UI preview.** The worktree's `.env.local` points at the **production** database, so a local dev server would write real rows. UI correctness rests on unit, render and source tests plus the build.
  - **Real-Postgres execution of the new refuel SQL.** No local Postgres is available, and a write against production (even rolled back) is not authorized. It is covered by an SQL-text test plus the in-memory simulation.

## 10. Files Changed
`git diff --name-status origin/main...82974b6`:
```
M	__tests__/rentalFillups.test.ts
M	__tests__/rentalFuelConfirmationGate.test.ts
A	__tests__/rentalPartACopy.test.ts
A	__tests__/rentalQuickSave.test.ts
M	__tests__/rentalReturnReminderCron.test.ts
A	__tests__/rentalSetupState.test.ts
A	__tests__/rentalTankCapacityTransitions.test.ts
M	__tests__/rentalTripFillCalculator.test.ts
M	app/api/ai/chat/route.ts
M	app/api/cron/rental-return-reminder/route.ts
M	app/api/rental-sessions/[id]/route.ts
M	app/help/page.tsx
M	app/rental-return/page.tsx
M	components/FuelGauge.tsx
A	components/rental-return/FinishSetupCard.tsx
M	components/rental-return/FuelLevelInput.tsx
A	components/rental-return/QuickSaveRentalForm.tsx
M	components/rental-return/RentalDashboard.tsx
A	docs/RENTAL_QUICK_SAVE_PART_A_PLAN.md
A	docs/RENTAL_UPCOMING_IMPORT_SPEC.md
A	docs/reviews/2026-10-02-rental-upcoming-import-spec.md
M	lib/rentalCalculations.ts
M	lib/rentalFillups.ts
A	lib/rentalQuickSave.ts
M	lib/rentalSessions.ts
A	lib/rentalSetupState.ts
M	lib/translations.ts
```
27 files, +1706 / −82. The packet commit adds this file and edits the two docs above.

## 11. Known Risks / Remaining Questions
- **The refuel SQL has not been executed on real Postgres.** The CASE expressions rely on Postgres evaluating every SET expression against the pre-update row, which is standard SQL semantics. A first-deploy check is recommended: a refuel on a rental with a known level still adds and clamps.
- **No live UI run.** Production DB in `.env.local`. A signed-in production smoke test after deploy is recommended (create a quick-saved TEST rental, walk Finish setup, then Don deletes it), as done for PR #58.
- **"Choose Full if you filled the tank" assumes the gauge is available.** On a rental with no tank size, only exact gallons is offered. Finish setup asks for the tank first, so this is a rare corner. The copy could say "or the exact gallons".
- **`FuelGauge` is shared with the main calculator.** The new `unset` prop defaults to `false`, and only `FuelLevelInput` (rentals) passes it.
- **A2/A3/A5 are one commit**, a deviation from the plan's per-step commits, because they share the dashboard and guard files and splitting them would leave red intermediate commits.
- **Process note:** one test I wrote used `NaN`, which JSON can't carry (it serializes to `null`, which is a tank-clear). It was caught by the test itself and replaced with `''` before the commit.

## 12. Claude's Assessment
**READY FOR REVIEW.** All checks are green. The two recommended post-deploy checks (refuel SQL on real Postgres, signed-in smoke test) are named above.

## 13. Questions for ChatGPT
1. Is rejecting `value → null` (422) the right UX given the model has no fraction column? Or should Part A add a nullable `pickupFuelFraction` / `currentFuelFraction` (a schema change) so a clear can keep the observation?
2. On `null → value`, absolute readings above the new capacity are clamped (consistent with the old change path). Should an absolute reading exceeding the new tank instead reject the tank entry, since one of the two numbers must be wrong?
3. The pickup-save rule seeds current only when no rental Fillup exists and current is unset or equals the old pickup reading. Any case where this leaves the renter without a current level they'd expect?
4. Is the quick-save zone requirement (each time must resolve in a zone) too strict for a user whose device zone can't be detected? They can still pick one with "Change".
5. Is the cron's choice of copy from `findMany(include)` fields acceptably "copy only", given the job object now carries `needsCarSetup`?

## 14. Requested Review Scope
Most scrutiny on:
1. `reconcileForTankCapacityChange` + `updateRentalSession` + the PATCH route invariant (A1), against the server-level tests.
2. The refuel SQL in `lib/rentalFillups.ts` (A2): correctness of the CASE expressions and preservation of the atomic-update guarantee.
3. The Prepare-for-Return unknown-target branch and the pickup-save rule in `RentalDashboard.tsx`.
4. The quick-save payload never carrying fuel, vehicle or UTC fields (`lib/rentalQuickSave.ts`).
