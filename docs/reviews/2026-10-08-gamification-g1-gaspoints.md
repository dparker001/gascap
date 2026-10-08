# ChatGPT Review Packet — Gamification G1 (GasPoints + Daily/Weekly Return Loop)

**Status: READY FOR INDEPENDENT REVIEW — GAMIFICATION G1.** Not merged, not deployed, **migration NOT run**.
Base `08c2321ff1cbd4ea447a22fae006f28bb11b419d` (main). Independent of the deferred Phase 1 P1-C.
Risk class: HIGH-adjacent (new persistent table, reward logic, compliance-adjacent copy next to the sweepstakes).

## 1. Objective
Give users a useful, fun reason to open GasCap between fill-ups:
**Daily Fuel Check -> GasPoints -> weekly 3-day mission -> level -> repeat visit** — without rewarding a meaningless app
open, and without touching giveaway entries, the visit streak, badges, sweepstakes/AMOE or the Daily Gift Box.

## 2. Repository State
Branch `feat/gamification-g1-gaspoints` from `origin/main` `08c2321`. One new table (migration script + Prisma model),
**not executed anywhere**. No experiment/P1-C code, no notifications, no backfill. Build-regenerated `public/sw.js` /
`workbox-*.js` were not committed.

## 3. What I Found (reused, not replaced)
`User.activeDays/streak`, badges, giveaway entry counters, Daily Gift Box and `DailyFuelPulse` already exist and are untouched.
`FuelPriceSnapshot` (156 weeks of national EIA grades) already provides the data the Daily Fuel Check needs. The central
persisted-record paths are `addFillup` (route), `createRentalFillup`, the gig route, `addVehicle` (route + CSV import) and the
favorites POST.

## 4. Exact point rules (server-owned; the client can never choose action, amount or key)
| Action | Points | Limit / identity (`idempotencyKey`) |
|---|---:|---|
| `welcome_bonus` | +25 | once lifetime — `welcome_bonus:<user>`; awarded with the first-ever Daily Fuel Check |
| `daily_fuel_check` | +5 | once per GasCap day — `daily_fuel_check:<user>:<YYYY-MM-DD>` |
| `weekly_3day_check` | +25 | once per GasCap week when the 3rd distinct check day lands — `weekly_3day_check:<user>:<Monday>` |
| `first_vehicle` | +25 | once lifetime — `first_vehicle:<user>` — after the vehicle row persisted |
| `first_saved_station` | +20 | once lifetime — `first_saved_station:<user>` — only when a NEW favorite row is created |
| `fuel_action` | +50 | once per GasCap day — `fuel_action:<user>:<YYYY-MM-DD of when it was LOGGED>` — after the fuel row persisted |

**Fuel actions** use the Phase 1 activation universe: personal, rental and gig *gallon-based* records that pass the same validity
rules (`isQualifyingFuelAction`: positive gallons/cost, plausible unit price, <=500 gal). EV/kWh gig records never earn. Values are
read from the persisted row, so a calculator plan can never earn (P1-B plan-vs-actual integrity unchanged).

**Canonical calendar:** `lib/gasCapCalendar.ts` — America/New_York, Monday–Sunday, one shared module (a test forbids tz logic elsewhere).
No client-controlled timezone ever reaches award identity.

**Levels** (derived from lifetime SUM, no level table): Starter 0–99, Road Ready 100–249, Fuel Smart 250–499, Smart Saver 500–999,
GasCap Elite 1000+ (no fake next threshold at the top; no level is called "Pro").

## 5. What I Changed
- **Schema/migration:** `GasPointLedger` (`id, userId, action, points Int, idempotencyKey UNIQUE, sourceRef?, createdAt`), FK to User
  `ON DELETE CASCADE`, indexes `(userId, createdAt)` and `(userId, action)`. `scripts/add-gaspoint-ledger.mjs` is additive and idempotent
  (`IF NOT EXISTS`), prints before/after, never touches existing rows, no `db push`. No balance column on `User`.
- **`lib/gasPointsRules.ts`** (pure: rules, levels, keys), **`lib/gasPoints.ts`** (ledger ops), **`lib/gasCapCalendar.ts`**, **`lib/fuelPulse.ts`**.
- **API:** `GET /api/gaspoints[?grade]` (read-only status + pulse) and `POST /api/gaspoints/daily-check` (body may contain only an optional
  display `grade`; any other field -> 400; session identity only; admin -> 403; rate-limited 20/min).
- **Daily Fuel Check card** (`components/GasCapDailyCard.tsx`, web home + native Calculator tab): balance, level + progress, weekly `n / 3`,
  existing visit streak (read-only), CTA "Check today's fuel pulse"; after the check it reveals the latest NATIONAL EIA weekly average for the
  chosen grade (default: grade of the last priceable fill-up, else Regular; Regular/Midgrade/Premium/Diesel switch), the real survey week, the
  week-over-week change only when the prior observation really is the prior week, a stale flag, and "a national weekly average, not your station".
  The award breakdown (e.g. +25 Welcome, +5 Daily, +25 Weekly) is shown, never hidden. Repeat the same day -> "Today's Fuel Check complete", zero.
- **Integrations:** personal `POST /api/fillups`, gig `POST /api/gig/fillups`, `createRentalFillup`, `POST /api/vehicles`, CSV vehicle import,
  `POST /api/favorites` — each awards only after its row exists and never fails the user's action. The fill-up response carries
  `gasPointsAwarded`; `FillupLogger` shows "+50 GasPoints for logging today's fill-up" beside (not inside) the unchanged truthful fuel-feedback card.
  Vehicle/station awards appear as a brief toast (`GasPointsToast`, plain text, reduced-motion safe).
- **Admin:** read-only `gasPoints` section in the engagement baseline (participants, Fuel Checks 7d, distinct checkers 7d, avg checks/checker,
  weekly mission this week/ever, level distribution) — real users only; test accounts and admins excluded; failure-isolated like `activation`.
- **Copy:** EN + ES `gasPoints` block (parity enforced by test), help page FAQ, AI APP FEATURES block; separation line on the card.
- **Existing tests updated:** `p1bFuelFeedback` (one regex now matches parsing the save response once so the same JSON carries the award; same
  semantics). `tc2aScopeGuards` "no schema diff" passes once the schema change is committed.

## 6. Security Impact
Authentication required; identity from the session only; no client user id; unknown body fields rejected; no amount/action/key accepted;
admin role read live from the DB (not the JWT) and excluded from earning; route is rate-limited. Awards are atomic inserts (unique key), so
double-clicks, retries and concurrent requests cannot duplicate. **No fraud controls beyond the stated per-day/lifetime limits**: acceptable only
because points have no value; stronger controls are required before any redemption/cash value is attached (documented in code and copy).

## 7. Data / Database Impact
New table only (additive). No existing table altered; no backfill; no points for historical visits, fill-ups, vehicles, stations or calculations.
Existing users start at 0 and receive the +25 Welcome Bonus on their first Daily Fuel Check. **The migration must be reviewed and run BEFORE the
code is deployed** (`railway run node scripts/add-gaspoint-ledger.mjs`); until then the new routes error and the admin section shows "not available".

## 8. User / Business Impact
A free, between-fill-ups reason to return that also surfaces real fuel data. GasPoints are explicitly separate from giveaway entries and have no
cash/redemption value (the card, help page and AI say so). No pricing, plan, entitlement, sweepstakes or giveaway change.

## 9. Testing Performed
- New: `g1GasPoints.test.ts` (68), `g1AdminRoute.test.ts` (4) — calendar/week boundaries (incl. Eastern midnight and Sunday->Monday), ledger atomicity,
  concurrent daily clicks, first-ever 25+5, repeat = 0, next day +5, weekly rules (same-day != 3, 3 distinct days, once, new Monday), fuel (valid,
  retry, same-day, EV/kWh, invalid, admin, after-persist ordering in all three fuel paths), first vehicle/station, pulse WoW logic, admin metrics
  exclusions, separation (no giveaway/streak/badge writes; those sources never mention GasPoints), API contract (rejects points/action/key/user),
  UI/copy (CTA, weekly x/3, levels, separation line, EN/ES key parity, no BUY/WAIT/prediction, no casino mechanics, reduced motion), migration shape.
- Fail-before: with the four route hooks reverted, 3 of the integration tests fail; the new modules/suites do not exist on `main`.
- Gates: see the PR (full `npm test`, `tsc`, `build`, `check:crons`, `check:sw` results are reported in chat and CI).

## 10. Files Changed
Schema/migration: `prisma/schema.prisma`, `scripts/add-gaspoint-ledger.mjs`. Lib: `gasCapCalendar`, `gasPointsRules`, `gasPoints`, `fuelPulse`,
`gasPointsMetrics`, `gasPointsClient`, `engagementBaselineLoader`, `rentalFillups`, `translations`. API: `gaspoints` (2 routes), `fillups`, `gig/fillups`,
`vehicles`, `vehicles/import`, `favorites`, `admin/engagement-baseline`, `ai/chat`. UI: `GasCapDailyCard`, `GasPointsToast`, `FillupLogger`, `SavedVehicles`,
`NearbyStations`, `EngagementBaselinePanel`, `NativeAppShell`, `app/page.tsx`, `app/help/page.tsx`, `app/globals.css`. Tests: 2 new, 1 adjusted.

## 11. Known Risks / Remaining Questions
1. **Migration-before-deploy** is mandatory; deploying first makes the card show its error state and the award hooks no-op (they swallow errors by design).
2. **First-vehicle reward for existing users:** the lifetime key means an existing customer who already has vehicles earns +25 the next time they save a
   vehicle (not retroactive for old rows, but not limited to brand-new users). Confirm that is intended.
3. **Test accounts earn** (so QA can exercise the loop) but are excluded from every aggregate; admins never earn.
4. **GasCap day is Eastern for everyone** (documented). Users in other zones reset at 9 PM Pacific / midnight Eastern.
5. **No jsdom:** UI behaviour is verified by source assertions, pure-model tests and the in-memory ledger; it needs a production QA pass after migration + deploy.
6. Rental fill-ups earn the +50 but show no inline reward line (no UI hook there); the award is still recorded.
7. The +50 is keyed on when the record was logged, not the user-entered fill date, so back-dated entries cannot farm daily rewards.
8. The weekly mission counts `daily_fuel_check` rows by their stored GasCap date (`sourceRef`), so a late-arriving write cannot move a check to another week.

## 12. Claude's Assessment
Within scope and the smallest ledger that satisfies the spec. The main review focus should be the atomicity/idempotency model, the eligibility
rules, and that no existing reward/giveaway/streak behaviour changed. Reversible by revert; the table is additive and may stay unused.

## 13. Questions for ChatGPT
Is the unique-key insert the right atomic primitive here (vs a transaction)? Should `first_vehicle` be limited to users with zero prior vehicles?
Is rate-limiting the daily-check route sufficient for zero-value points? Is the Eastern-only calendar acceptable for G1?

## 14. Requested Review Scope
`lib/gasPoints.ts` (award/daily/weekly), `lib/gasPointsRules.ts`, the migration script and Prisma model, the six integration points, the two API routes,
admin metrics, and the copy that separates GasPoints from giveaway entries.
