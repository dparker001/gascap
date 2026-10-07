# ChatGPT Review Packet — GasCap Daily Phase 0.5 (measurement baseline + fuel-price data foundation)

Filled from `docs/reviews/CHATGPT_REVIEW_PACKET_TEMPLATE.md`. Risk class: **HIGH**
(schema change, new cron, core fill-up write path, savings/pricing claims shown
to users). Stopped at READY FOR REVIEW. **Not merged. Not pushed. Migration not run.**

---

## 1. Objective

Don approved a reduced scope for GasCap Daily and asked for **Phase 0.5 only**:

- **0.5A — Measurement baseline:** an admin view of current retention, DAU/WAU,
  fuel actions, paywall exposure, upgrade clicks, trial→paid and cancellations,
  built from existing data, so GasCap Daily can later be judged against a real
  baseline.
- **0.5B — Fuel intelligence data foundation:** `FuelPriceSnapshot`, verified
  EIA product/grade mapping, real observation timestamps, stale-data
  safeguards, a corrected Savings Dashboard methodology, and defensible
  baseline fields captured on future fill-ups without storing precise location.

Explicitly **not** in scope (Don): any GasPoints/streak/check-in/challenge/score
UI, `GasPointTransaction`, `GamificationAssignment`, `User.timeZone`, feature
flags, redemption, notifications.

## 2. Repository State

- **Branch:** `feat/gascap-daily-phase05` (fresh from current `origin/main`;
  NOT built on `feat/rental-history-reminders`; upstream tracking removed so a
  stray `git push` cannot target `main`).
- **Review Target SHA:** `8f0e540c848c36524690b6c453b7c11595567f4e`
- **Packet Commit SHA:** the commit that records this file (follows the target).
- **Base branch:** `main` @ `776dabf5b7838138d7bbd41c4723a81122e7eb27`
- **Relevant PR:** none opened.
- **Review this diff:** `git diff --name-status origin/main...8f0e540c848c36524690b6c453b7c11595567f4e`
  (41 files; real output in §10).

## 3. What I Found

Verified against the repository and live EIA (read-only) on 2026-10-07:

1. **No price history existed anywhere.** No table, no JSON store, nothing.
2. **`SavingsDashboard` fabricated its headline number three ways:** it compared
   *every historical fill-up* to *today's* national Regular price; it mixed
   fuel grades (a premium fill-up looked "above average"); and when EIA was
   unreachable it silently substituted a hardcoded **$3.45** and still labelled
   the result "savings". `FillupHistory` row badges and `FillupLogger`'s price
   card had the same today's-price / grade-mixing flaw.
3. **`/api/gas-price/history` queried EIA product `EPM0` under a "Regular"
   label.** `EPM0` is *Total Gasoline* (all grades blended). Live that day:
   national `EPM0` $4.496 vs `EPMR` (Regular) $4.354 — a 14¢ overstatement on
   the public price chart. The other EIA callers already used `EPMR`.
4. **`/api/gas-price/national` returned `updatedAt: new Date()`** — cache
   retrieval time presented as the price's date. EIA's `period` was fetched and
   discarded.
5. **Stale seed, unlabelled.** `data/gas-prices-seed.json` is dated 2026-06-23
   (national $4.052 vs $4.354 live). On any cold process `/api/gas-price`
   served it as the price with no indication of age; `live:false` was the only
   hint and no client reads it.
6. **Real EIA payload shape** (provider-contract rule): `value` is a *string*,
   rows carry extra descriptive fields, and several state series do not exist
   for every product (e.g. no Florida state diesel series — 8 of 17 areas lack
   diesel). The area chain therefore has to fall through state → region →
   national *per product*.
7. **EIA latency is ~7–10 s per request regardless of size** (measured). Four
   sequential grade requests (~30–40 s) would have exceeded the cron workflow's
   shared `curl --max-time 30`. Fixed (see §11 process notes).
8. Admin retention/DAU/funnel views did not exist; `AnalyticsEvent` was written
   but never aggregated; page visits are **not** events (only `User.activeDays`).
9. No Stripe cancellation record exists (subscription id is just cleared).
   Stripe `purchase_completed` is not filtered for test mode (RevenueCat's is).

## 4. What I Changed

**Phase 0.5A — baseline (read-only)**

| File | Purpose | Before → After |
|---|---|---|
| `lib/engagementBaseline.ts` | Pure computation; all definitions encoded | none → D1/3/7/14/30 retention (matured cohorts only), DAU/WAU/MAU, funnel, fuel actions, paywall, trial→paid, cancellations, plus its own `definitions` + `dataQuality` caveats |
| `lib/engagementBaselineLoader.ts` | SELECT/groupBy only | excludes `isTestAccount` and `role=admin`; selects no PII columns |
| `app/api/admin/engagement-baseline/route.ts` | Admin GET | `requireAdmin` (session role from DB, legacy header deprecated), 401/403/503, `no-store`, aggregate-only response |
| `components/admin/EngagementBaselinePanel.tsx` + `app/admin/page.tsx` | UI | panel mounted next to Rental Pilot |

**Phase 0.5B — fuel-price foundation**

| File | Purpose | Before → After |
|---|---|---|
| `prisma/schema.prisma`, `scripts/add-fuel-price-snapshot.mjs` | Schema | `FuelPriceSnapshot` table; 4 **nullable** `Fillup.baseline*` columns; additive/idempotent SQL with before/after state |
| `lib/eiaAreas.ts` | Single source of truth | verified product map; `EPM0` deliberately unmapped; unknown grade → `null`, never "regular"; state→region→national chain |
| `lib/eiaClient.ts` | EIA v2 client | pure parse/URL; drops rows without a real `YYYY-MM-DD` period or with implausible price; grades fetched in parallel |
| `lib/fuelPriceSnapshots.ts`, `app/api/cron/fuel-price-snapshot/route.ts`, `.github/workflows/crons.yml` | History accumulation | insert-only `createMany(skipDuplicates)`; daily 22:25 UTC (outside 9:45–10:15 AM ET); 503 if `CRON_SECRET` unset, constant-time compare, 502 when EIA unreachable **or** itself stale; `?weeks=` backfill (cap 156); workflow `--max-time` 90 for this endpoint only |
| `lib/eiaFreshness.ts` | Staleness | >14 days = stale (one missed release + holiday ≈ 9 days is *not* stale) |
| `lib/gasPrices.ts`, `app/api/gas-price/route.ts` | Stale-seed ambiguity | memory cache now carries the EIA `period`; responses add `priceSource`/`asOf`/`stale`; cold process prefers newest stored EIA observation over the seed; all existing fields unchanged |
| `app/api/gas-price/national/route.ts` | Observation vs retrieval | adds `period`, `fetchedAt`, `stale`, `?grade=`; `updatedAt` kept as **deprecated alias of `period`**; unsupported grade → 400 |
| `app/api/gas-price/history/route.ts` | Wrong product | `EPM0` → `EPMR` |
| `lib/savingsBaseline.ts`, `app/api/fillups/savings/route.ts` | Savings methodology | per-fill-up, same grade, EIA week on/before fill date (≤13 days), sanity checks; explicit exclusion reasons; **no fallback constant**; negative savings reported |
| `lib/fillups.ts`, `app/api/fillups/route.ts`, `components/FillupLogger.tsx` | Future baselines | `addFillup` freezes `baselinePrice/Source/Area/Period` best-effort (failure never blocks logging); only the coarse EIA area is stored; edit of date/grade clears it |
| `components/SavingsDashboard.tsx`, `FillupHistory.tsx`, `FillupLogger.tsx` | UI | dashboard shows server-computed savings, "N of M compared", "Not enough data yet" state, in-card methodology; history badges per-fill-up; logger card grade-matched with EIA week |
| `app/help/page.tsx`, `app/api/ai/chat/route.ts`, `app/features/page.tsx`, `lib/translations.ts` (EN+ES) | Copy | describes the real methodology (CLAUDE.md docs rule) |
| `docs/FUEL_PRICE_HISTORY.md` | Docs (`CURRENT`) | architecture, verified mapping, ops, rollback |

**Scope expansion to call out:** Don named the *Savings Dashboard*; I also moved
`FillupHistory` badges and `FillupLogger`'s inline card off the same flawed
comparison, because leaving them would have kept the exact behavior Don
prohibited ("do not compare historical fuel purchases against today's national
price", "do not mix fuel grades") on two other screens.

## 5. Architectural Decisions

- **Insert-only, first-seen-wins snapshots** (`skipDuplicates`) rather than
  upsert. A price already shown to a user must not silently change; EIA does
  not routinely revise weekly retail prices. *Cost:* a genuine EIA revision
  would be ignored. *Alternative rejected:* upsert-latest.
- **Compute savings server-side**, not in the browser. The old logic lived in
  the component, which is how a hardcoded fallback and a different benchmark
  than the history screen could coexist. One implementation, one set of rules.
- **Freeze a baseline at log time + recompute from history for old rows.**
  Frozen = the figure a user saw stays true; history lookup = old fill-ups still
  get an honest *national* comparison.
- **Exclude rather than estimate.** Unknown grade, e85, no EIA week, or
  implausible numbers → excluded with a reason and counted in coverage. *Cost:*
  coverage for legacy fill-ups without a fuel grade will be low until users add
  grades — deliberate; the UI says so.
- **National benchmark only for legacy rows.** No location was ever stored for
  personal fill-ups, so regional matching is impossible for them. Methodology
  text says it is a national benchmark.
- **State hint from `localStorage`** (`gc_last_gas_price`, written by
  `GasPriceLookup`) instead of a new geolocation prompt or an IP lookup on the
  write path. Only the resulting EIA area is stored. *Alternative rejected:*
  server-side IP geolocation (third-party call + latency on the core write path).
- **Retention from `activeDays`**, because visits are not events. Day 0 =
  earlier of signup UTC date and first active day, to absorb client-local vs
  UTC date skew.
- **Cron fails loudly only when unexpected:** 502 on EIA failure/staleness, 200
  and silent otherwise (CLAUDE.md: never alert daily on expected state).
- **Did not edit `tc2aScopeGuards`** (see §11) or refresh the stale seed file.

## 6. Security Impact

- **Fixed:** none (no vulnerability addressed).
- **New surface and its controls:**
  - `GET /api/cron/fuel-price-snapshot`: fails closed (503 when `CRON_SECRET`
    unset — the `if (secret && …)` bug shape is explicitly tested), 401 on
    wrong/missing, constant-time compare, secret never echoed; error log
    redacts any `api_key=`; EIA key only in the outbound URL, never persisted.
  - `GET /api/admin/engagement-baseline`: `requireAdmin` only; response is
    aggregate counts with **no per-user identifiers** (tested); loader selects no
    email/name/hash/token columns (tested); test accounts and admins excluded.
  - `GET /api/fillups/savings`: session required, reads only the caller's own
    fill-ups (tested).
  - `/api/gas-price/national?grade=`: allowlisted grades, 400 otherwise.
- **Authentication/authorization behavior of existing routes: unchanged.** No
  Stripe/RevenueCat/entitlement/serverPlan/IAP file modified (protected-path
  guard passes with no exceptions registered). The baseline module reads
  entitlements via the existing pure `resolveUserEntitlements`.
- **Remaining:** the new admin route accepts the deprecated legacy
  `x-admin-password` header like every other admin route (existing
  `docs/ADMIN_AUTH_MIGRATION.md` debt, not worsened).
- `areaState` is user-asserted and unauthenticated by nature; it can only alter
  the user's own savings display today. **If Phase 1 ever awards points or
  rewards from savings, that value must not be trusted.**

## 7. Data / Database Impact

- **Schema (additive only):** new table `FuelPriceSnapshot`; four nullable
  columns on `Fillup` (`baselinePrice`, `baselineSource`, `baselineArea`,
  `baselinePeriod`). `scripts/add-fuel-price-snapshot.mjs`: `IF NOT EXISTS`
  everywhere, no DROP/TRUNCATE/DELETE/UPDATE/ALTER COLUMN (asserted by test),
  prints before/after state and fails if the `Fillup` row count changes.
- **No backfill of user data.** Existing `Fillup` rows are untouched (new
  columns NULL). Price-history backfill is *new rows from EIA* via the cron's
  `?weeks=156`; nothing synthesized.
- **No destructive operation occurred. Nothing was run against production.**
  The migration has **not been executed anywhere** (no database was touched in
  this work); correctness of the DDL is verified statically and against
  `schema.prisma` in tests only.
- **DEPLOY-ORDER HAZARD (important):** `addFillup` writes the new columns and
  `getFillups` reads every `Fillup` column. If this code reaches production
  before the migration runs, **fill-up creation and reads will error.** The
  migration must run first. (Everything touching `FuelPriceSnapshot` degrades
  gracefully if the table is missing; the `Fillup` columns do not.)
- Rollback: revert the deploy; leave the table/columns (inert, nullable, no
  destructive DDL on prod). Nothing else to undo.

## 8. User / Business Impact

- **Free/Pro/entitlements/pricing/giveaway/sweepstakes/rewards/streaks: no
  change.** `recordActivity`/`activeDays`/giveaway entry code untouched.
- **Users will see lower — and different — savings numbers.** The old figure was
  inflated by today's-price and grade-mixing. Any legacy fill-up without a fuel
  grade will be excluded (how many that is in production is unmeasured — see
  §11); users with nothing comparable will see "Not enough data yet" until they
  log grades. Anyone who could have seen a milestone badge from the
  inflated figure may see it disappear. This is intended, but it is a visible
  change to something users saw.
- **Calculator pre-fill prices may rise on cold starts** (~30¢ nationally vs the
  June seed) because `/api/gas-price` now prefers stored EIA data over the seed.
  More accurate; also visible.
- The public price chart drops ~14¢ (Regular instead of all-grades).
- No new notifications, emails or pushes. No native-config change (no Codemagic
  rebuild).
- Owner: Don gets the first real baseline (retention/conversion) the day the
  admin panel loads.

## 9. Testing Performed

Actual results, on the committed tree (`8f0e540c848c`):

```
npm run check:crons   → ✓ cron inventory: 22 routes, 20 scheduled, 2 exempt
npm test              → Test Files 161 passed (161); Tests 2661 passed (2661)
npx tsc --noEmit      → exit 0, no output
npm run build         → exit 0, "✓ Compiled successfully" (CI-equivalent placeholder env)
```

- Baseline before this work: 2509 tests / 149 files (2661 − 152 new / 161 − 12 new).
- **152 new tests in 12 files**, all passing.
- **Regression tests shown to fail against old behavior:** copied the new
  regression/behavior tests into a scratch worktree at `origin/main`
  (776dabf5b783): **22 of 22 fail** there (SavingsDashboard $3.45/today's-price,
  FillupHistory, FillupLogger, `EPM0`, `updatedAt: new Date()`, unlabelled seed,
  help/AI copy). They pass on the branch. (The first 6 were also run red before
  any production code was changed.)
- **Provider-contract:** fixtures are real EIA v2 rows captured 2026-10-07
  (string `value`, extra fields, missing Florida diesel series); includes
  positive, malformed, out-of-range, missing-date, unmapped-product (`EPM0`),
  non-OK and no-key paths. A **live read-only smoke** (real client + parser, 17
  areas × 4 grades, no DB) returned 204 rows over 6 weeks, national Regular
  $4.354, Florida Regular → `SFL`, Florida diesel → falls back to `R1Z`.
- Boundary/timezone: ET "today" vs UTC at the day boundary, DST-free
  YYYY-MM-DD day math, Day-0 client/UTC skew, 13- vs 14-day match window,
  14-day staleness threshold.
- Idempotency: snapshot sync run twice inserts 0 the second time; first-seen
  value is not overwritten.
- Authorization: cron 503/401/200/502 matrix; admin route 401/403/503 with **no
  query issued**; savings route 401 and own-data scoping.
- **Not tested / limits:** no real database (repo has no DB test harness — the
  migration is verified statically + schema sync, not executed); UI components
  were verified by typecheck/build/source assertions, **not exercised in a
  browser** (no authenticated session or data locally); live production data
  was not queried, so actual baseline values and fuel-grade coverage are
  unknown until the panel is loaded in production.
- Pre-existing `tc2aScopeGuards` "no prisma schema diff" fails in a working tree
  with an *uncommitted* schema edit and passes once committed (re-run on the
  committed tree: pass, as in the 2661/2661 above).

## 10. Files Changed

```
M	.github/workflows/crons.yml
A	__tests__/eiaAreasAndFreshness.test.ts
A	__tests__/eiaClient.test.ts
A	__tests__/engagementBaseline.test.ts
A	__tests__/engagementBaselineRoute.test.ts
A	__tests__/fillupBaselineCapture.test.ts
A	__tests__/fillupsSavingsRoute.test.ts
A	__tests__/fuelPriceSnapshotCronRoute.test.ts
A	__tests__/fuelPriceSnapshotMigration.test.ts
A	__tests__/fuelPriceSnapshotStore.test.ts
A	__tests__/gasPriceFreshnessRoutes.test.ts
A	__tests__/phase05FuelDataRegression.test.ts
A	__tests__/savingsBaseline.test.ts
M	app/admin/page.tsx
A	app/api/admin/engagement-baseline/route.ts
M	app/api/ai/chat/route.ts
A	app/api/cron/fuel-price-snapshot/route.ts
M	app/api/fillups/route.ts
A	app/api/fillups/savings/route.ts
M	app/api/gas-price/history/route.ts
M	app/api/gas-price/national/route.ts
M	app/api/gas-price/route.ts
M	app/features/page.tsx
M	app/help/page.tsx
M	components/FillupHistory.tsx
M	components/FillupLogger.tsx
M	components/SavingsDashboard.tsx
A	components/admin/EngagementBaselinePanel.tsx
A	docs/FUEL_PRICE_HISTORY.md
A	lib/eiaAreas.ts
A	lib/eiaClient.ts
A	lib/eiaFreshness.ts
A	lib/engagementBaseline.ts
A	lib/engagementBaselineLoader.ts
M	lib/fillups.ts
A	lib/fuelPriceSnapshots.ts
M	lib/gasPrices.ts
A	lib/savingsBaseline.ts
M	lib/translations.ts
M	prisma/schema.prisma
A	scripts/add-fuel-price-snapshot.mjs
```

## 11. Known Risks / Remaining Questions

### Open review items (explicit — each needs a reviewer decision or an owner action)

1. **Migration-before-deploy is mandatory.** `scripts/add-fuel-price-snapshot.mjs`
   must be run against the production database (Railway project
   **caring-integrity** only) **before** this code is deployed. `addFillup`
   writes, and `getFillups` reads, the four new `Fillup.baseline*` columns; if
   the code ships first, fill-up creation and reads will error. A merge to
   `main` is a deploy. *Not run as part of this review step.*
2. **Stripe `purchase_completed` test-mode filtering is inconsistent.**
   RevenueCat's `purchase_completed` is production-only (sandbox excluded
   upstream); Stripe's is **not** filtered for test mode — only `isTestAccount`
   excludes owner/test purchases. The new admin baseline therefore can count a
   Stripe test-mode purchase made by a non-flagged account. Disclosed in the
   panel's data-quality notes; **not fixed** (payment webhook is a protected
   path, out of scope).
3. **Rental Pilot still uses a flat `$3.30/gal` estimated-savings calculation.**
   `app/api/admin/rental-pilot/route.ts` (`approxSelfCost =
   estimatedFuelCost(needed, 3.30)`) — a hardcoded price standing in for a real
   one, the same class of problem fixed for the Savings Dashboard. Admin-only
   aggregate; **left unchanged**.
4. **The committed fallback seed is stale (2026-06-23).**
   `data/gas-prices-seed.json` (national $4.052 vs $4.354 live on 2026-10-07).
   It is now labelled (`priceSource: 'seed'`, `asOf`, `stale: true`) and only
   used when no stored EIA observation exists, but it has **not been
   regenerated** (`scripts/generate-gas-price-seed.mjs`).
5. **`areaState` is user-asserted and unsuitable for rewards.** It comes from
   the client (last price lookup in `localStorage`), is unauthenticated, and is
   not verified against any location. It only selects the coarse EIA area for
   the user's *own* savings display. It **must not** be used to award points,
   entries, or any reward in Phase 1 or later.
6. **Authenticated UI smoke testing is required before production
   verification.** No component was exercised in a browser during this work
   (no authenticated session or representative data locally). UI is covered
   only by typecheck, build and source/behavior assertions. Before relying on
   this in production someone must, signed in: load the Savings Dashboard
   (with graded, ungraded and e85 fill-ups), the fill-up history badges, the
   fill-up logger price card (with/without a grade), log a fill-up and confirm
   the baseline columns populate, and load the admin Engagement Baseline panel.
   *Production data and fuel-grade coverage were also not queried.*

### Other known risks

1. **Migration-before-deploy ordering** (§7). The single biggest operational
   risk; Don must run it before merging. A merge to `main` deploys.
2. **Fuel-grade coverage is unknown.** `Fillup.fuelGrade` is optional. If most
   legacy fills lack it, the dashboard will show few comparisons. I did not
   query production to measure this. Suggested read-only check:
   `SELECT "fuelGrade", count(*) FROM "Fillup" GROUP BY 1;`
3. **National benchmark flatters/penalizes by region** for legacy fills (a
   Florida driver is compared to the U.S. average). Disclosed in the methodology
   text; new fill-ups get a state/region baseline when a state is known.
4. **`areaState` is client-asserted** (see §6).
5. **`addFillup` is the core write path.** The baseline lookup is wrapped so it
   cannot fail the fill-up, and adds up to one indexed query. Highest-scrutiny
   code in the diff.
6. **Retention caveats:** `activeDays` mixes client-local and UTC dates; deleted
   accounts are absent (survivorship); `trial_started` events only begin when
   instrumentation shipped, so trial counts use a union and both parts are shown.
7. **Stripe `purchase_completed` is not test-mode filtered;** no Stripe
   cancellation record exists. Reported honestly in the panel, not fixed.
8. **Existing hardcoded estimate elsewhere:** the admin Rental Pilot panel's
   "average estimated savings" uses a flat **$3.30/gal** (`app/api/admin/rental-pilot/route.ts`).
   Admin-only aggregate; same class of problem; **not changed** (out of scope).
9. **Stale seed file remains** (`data/gas-prices-seed.json`, 2026-06-23). It is
   now clearly labelled and only used if no stored EIA data exists. Regenerating
   it (`scripts/generate-gas-price-seed.mjs`) would still be worthwhile.
10. `tc2aScopeGuards` "no prisma schema diff" is brittle: any local schema edit
    fails it until committed. Left untouched (not mine to bypass).
11. EIA latency spikes: cron has a 40 s per-request timeout, parallel grades,
    and a 90 s workflow budget; a sustained EIA outage turns the run red by design.
12. `/api/fillups/savings` is called by both the dashboard and history list and
    loads all of a user's fill-ups each time. Fine at current scale.
13. Cron/`crons.yml` change: avoid *merging* during the 9:45–10:15 AM ET window.

**Process mistakes made and corrected during the work:**
- Wrote the cron/EIA client with **sequential** grade requests; a live smoke
  test showed ~41 s, which would have failed the workflow's 30 s limit. Switched
  to parallel and raised only this endpoint's `--max-time`.
- A trial-union expectation in my own test was mis-added by hand (5 vs 4); the
  implementation was right, the test was wrong — fixed after running it.
- My first `EPM0` regression assertion matched my own explanatory *comment*;
  tightened to the actual query parameter.
- A secret-scan one-liner errored (regex quirk) *after* I committed; re-ran it
  correctly against the commit (clean).
- `next build` rewrites `public/sw.js`; I restored it rather than committing a
  build artifact.
- I used the local `.env.local` EIA key for read-only API verification (never
  printed or committed).

## 12. Claude's Assessment

**READY WITH KNOWN CONCERNS** — the logic and tests are solid and everything
verifiable here passes, but it must not merge until the migration is run first,
and I could not exercise the UI in a browser or measure real production
coverage.

## 13. Questions for ChatGPT

1. `addFillup` wraps `resolveNewFillupBaseline` in try/catch before
   `prisma.fillup.create`. Is there any path where a baseline failure still
   escapes, or where it delays/changes the write?
2. Is "first-seen wins" (`skipDuplicates`) the right policy vs. upsert given
   EIA's revision behavior? What evidence would settle it?
3. `findBaselineForDate` uses the latest EIA week **on or before** the fill date,
   ≤13 days. Does that introduce look-ahead or staleness bias? Is 13 right?
4. Is `|paid − baseline| > $3/gal ⇒ invalid` and the 50% price-vs-total
   mismatch rule too strict/too loose for diesel or Hawaii/Alaska prices?
5. The hazard in §7: is there a safer pattern than "run SQL first" for adding
   nullable `Fillup` columns on this Prisma setup (e.g. select lists), or is
   documented ordering the accepted convention here?
6. `/api/gas-price` now reads the DB on cold processes. Any scenario where the
   snapshot is *less* correct than the seed it replaces?
7. Are the retention/Day-0/matured-cohort definitions in
   `lib/engagementBaseline.ts` internally consistent? Any double-counting in the
   union trial definition or the funnel's monotonicity claim?
8. Does the admin route leak anything the loader's column selection or the
   aggregate shape would not prevent?
9. Cron semantics: is 502-on-stale (EIA's newest week >14 days) the right
   trade-off vs. a silent 200, given CLAUDE.md's "don't alarm on expected state"?

## 14. Requested Review Scope

Most scrutiny, in order:
1. `lib/fillups.ts` (`addFillup`, `updateFillup`) — core write path.
2. `scripts/add-fuel-price-snapshot.mjs` + `prisma/schema.prisma` — DDL safety,
   sync, and the deploy-order hazard.
3. `lib/savingsBaseline.ts` + `app/api/fillups/savings/route.ts` — whether any
   displayed number can still be inflated, mixed-grade, or invented.
4. `app/api/cron/fuel-price-snapshot/route.ts` + `lib/fuelPriceSnapshots.ts` +
   `.github/workflows/crons.yml` — auth, idempotency, failure semantics.
5. `app/api/gas-price/route.ts` + `lib/gasPrices.ts` — user-visible price source change.
6. `lib/engagementBaseline.ts` — metric definitions (the baseline must be right).

Lower priority: UI components, translations, docs.
