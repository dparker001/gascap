# Fuel-price history & savings baseline

**Status: CURRENT — DEPLOYED to production and backfilled (2026-10-08).** Implemented in Phase 0.5B (PR #65,
with follow-ups #66 price provenance, #68 service-worker integrity, #69 admin panels). Final outcome below.

## Why this exists

Before this, GasCap kept **no price history of any kind**. Consequences:

- "Change vs last week", a 30-day "normal", and any honest savings figure were
  impossible.
- The Savings Dashboard compared every historical fill-up with **today's**
  national price, mixed fuel grades, and fell back to a hardcoded **$3.45**
  presented as if it were a real baseline.
- `/api/gas-price/history` queried the wrong EIA product under a "Regular"
  label.
- `/api/gas-price` could serve a months-old committed seed with nothing
  saying so.

## Data source and verified mapping

EIA v2, `petroleum/pri/gnd`, weekly retail prices. Product codes verified live
against `api.eia.gov/v2/petroleum/pri/gnd/facet/product` on **2026-10-07**:

| GasCap grade | EIA product | EIA name |
|---|---|---|
| regular | `EPMR` | Regular Gasoline |
| midgrade | `EPMM` | Midgrade Gasoline |
| premium | `EPMP` | Premium Gasoline |
| diesel | `EPD2D` | No 2 Diesel |
| — | `EPM0` | **Total Gasoline (all grades blended) — never a Regular price** |

E85 has no series; a fill-up with a missing or unsupported grade is **never
assumed to be regular**. Single source of truth: `lib/eiaAreas.ts`.

Live check that day: national `EPMR` $4.354 vs `EPM0` $4.496 (14¢ apart) —
the size of the error the old history chart carried.

Areas snapshotted (17): `NUS`, the 7 PADD sub-regions (`R1X R1Y R1Z R20 R30
R40 R50`), and the 9 states EIA publishes directly (`SCA SCO SFL SMA SMN SNY
SOH STX SWA`). Not every product exists for every area (e.g. Florida has no
state diesel series); lookups walk **state → region → national** and use the
first area with a qualifying observation.

## Time semantics (important)

- `observedOn` = EIA's **survey date** (a Monday) = when the price was
  observed.
- `fetchedAt` = when we stored it. **Never present it as the price date.**
- An EIA row without a valid `YYYY-MM-DD` period is dropped, not stamped with
  today's date.
- Freshness: an observation older than **14 days** is `stale`
  (`lib/eiaFreshness.ts`). One missed weekly release plus a holiday delay
  (~9 days) is normal and is *not* stale.

## Storage

Table `FuelPriceSnapshot` (`source, duoarea, product, grade, observedOn,
price, fetchedAt`; unique on `source+duoarea+product+observedOn`). Written
only by `lib/fuelPriceSnapshots.ts` via `createMany(skipDuplicates)`:
**insert-only, idempotent, first-seen value wins** (a price once shown to a
user must not change under them; EIA does not routinely revise weekly prices).

Cron `GET /api/cron/fuel-price-snapshot` — daily **22:25 UTC (6:25 PM EDT /
5:25 PM EST)**, after EIA's Monday release and outside the 9:45–10:15 AM ET
protected window. Daily cadence only makes a late/Tuesday-holiday release land
within a day. `?weeks=N` (default 3, max 156) controls the window; use
`?weeks=156` once for the initial backfill (real EIA history, nothing
synthesized).

Failure is loud, expected state is silent:

| Situation | Response |
|---|---|
| `CRON_SECRET` unset | 503 (our misconfiguration; never trusts the caller) |
| wrong/missing secret | 401 |
| EIA unreachable / no valid rows / key missing | 502 → GitHub Actions run goes red |
| newest national Regular week > 14 days old (EIA stopped publishing) | 502 |
| normal run | 200, one log line |

## Savings baseline rules (`lib/savingsBaseline.ts`)

A fill-up gets a savings figure only if **all** hold:

1. Priceable grade (regular/midgrade/premium/diesel).
2. An EIA observation **of that grade** on/before the fill date and ≤ **13
   days** before it.
3. Sane numbers: positive gallons/cost; `totalCost/gallons` within 50% of the
   entered price; |paid − baseline| ≤ $3/gal.

Else it is **excluded with a reason** (`no_grade`, `unsupported_grade`,
`no_baseline`, `invalid`) and contributes nothing. There is no fallback
constant. Savings can be negative and is reported as-is.

`savings = baseline × gallons − totalCost` (`totalCost` = actual amount paid,
so pump-rounded or discounted totals count).

**New fill-ups freeze their baseline at log time** into four nullable `Fillup`
columns (`baselinePrice, baselineSource, baselineArea, baselinePeriod`). Only
the coarse EIA area actually used is stored (`NUS`, `R1Z`, `SFL`…) — never a
coordinate, address or zip. The client may send a two-letter state (taken from
the last price lookup already in `localStorage`; no new location prompt) which
selects the area chain and is not stored. Editing a fill-up's date or grade
clears the frozen baseline. Older fill-ups are matched from history against
the **national** series at read time (`origin: 'snapshot'`); regional matching
is not possible for them (no location was ever stored).

Server endpoint: `GET /api/fillups/savings` (own data only). Consumers:
`SavingsDashboard`, `FillupHistory` row badges. `FillupLogger`'s inline card
compares only against the **selected grade's** current EIA average, with the
EIA week shown.

## Price provenance (follow-up to PR #65)

A state price request is answered from the first EIA series that responds,
walking **state → PADD region → national**. That fallback is legitimate, but the
result must always say which series actually supplied the number.

Production bug (2026-10-07): a Florida request returned the **national** Regular
price ($4.354) labelled `eia_live`; Florida's own series (`SFL`) was $3.97. The
lookup returned only `{price, period}`, so when the finer requests timed out the
national value was cached under the Florida key for 6 hours.

Now:

- `resolveStateLive()` returns `{price, period, area, scope}`; the cache keeps
  `area`/`scope` and `getStatePrice()` returns them. Seed results carry
  `area: null, scope: null` (the seed's per-state provenance was never recorded).
- A cached result from a **less specific** area than the state's best series is
  a stopgap: it is cached for **10 minutes**, then the specific series is
  retried. A result from the best series keeps the 6 h TTL. (A state with no
  series of its own, e.g. Georgia, treats its region as its best.)
- The per-request EIA timeout is 20 s (was 7 s) — it runs in a background
  refresh, and EIA latency was measured from 0.5 s to >30 s. One refresh per
  state is in flight at a time.
- `GET /api/gas-price` adds `priceArea` (`SFL`/`R1Z`/`NUS`), `priceScope`
  (`state|region|national`), `priceFallback` (true when less specific than the
  state's best series; null when unknown), alongside `priceSource`
  (`eia_live|eia_snapshot|seed`), `asOf`, `stale`.
- **`isState`/`isNational` now describe the price, not the request** whenever
  provenance is known. A Florida request answered with national data reports
  `isState:false, isNational:true`. For the seed (no provenance) they keep the
  old request-based meaning. All other fields are unchanged.
- `GasPriceLookup` (the only UI consumer) labels by scope — state / "Regional
  weekly avg" / national — instead of always printing "<State> avg".
- `FuelPriceSnapshot` is unaffected: it already stores the real `duoarea` per
  row, and `latestSnapshotForChain` returns the area it used.

## Price routes

- `GET /api/gas-price` (state price): adds `priceSource`
  (`eia_live | eia_snapshot | seed`), `asOf`, `stale`. On a cold process it now
  prefers the newest stored EIA observation over the committed seed
  (`data/gas-prices-seed.json`, generated 2026-06-23). Existing fields
  unchanged.
- `GET /api/gas-price/national[?grade=]`: adds `period` (EIA survey date),
  `fetchedAt`, `stale`, `grade`. `updatedAt` is kept as a **deprecated alias of
  `period`** (it used to be retrieval time).
- `GET /api/gas-price/history`: now `EPMR` (was `EPM0`).

## Operations

Migration (additive, idempotent, run **before** deploying the code):

```bash
railway run node scripts/add-fuel-price-snapshot.mjs
```

Initial backfill (after deploy; read-only against EIA, insert-only locally;
use a long timeout, ~10k rows):

```bash
curl -s --max-time 300 "https://www.gascap.app/api/cron/fuel-price-snapshot?weeks=156&secret=$CRON_SECRET"
```

Rollback: stop at the code level (revert the deploy). The new table and
nullable columns are inert without the code and are deliberately **not**
dropped (no destructive production DDL). Every consumer degrades to "no
baseline / seed" if the table is missing or empty.

## Production outcome (2026-10-08) — Phase 0.5 COMPLETE

- **Schema:** `scripts/add-fuel-price-snapshot.mjs` run once against production (additive; `Fillup` rows unchanged).
- **Backfill:** `GET /api/cron/fuel-price-snapshot?weeks=156`, run once on production at `da51479`. Insert-only and
  idempotent: 204 existing rows → **10,608** (+10,404; the 204 were skipped as duplicates).
- **Coverage:** Regular, Midgrade, Premium — exactly **156 weeks × 17 areas** each (2023-10-16 → 2026-10-05), no weekly
  gaps. Diesel — 9 areas, 295 weeks (from 2021-02-15; EIA's per-request row limit returns more weeks for the areas that
  have the series). The 8 state areas with no EIA diesel series (CO, FL, MA, MN, NY, OH, TX, WA) are absent by design and
  resolve through state → region → national.
- **Integrity:** mapping EPMR/EPMM/EPMP/EPD2D with 0 mismatches and 0 `EPM0` rows; 0 duplicate unique keys; 0 bad dates or
  prices; every `observedOn` a Monday; each row keeps its real EIA `duoarea`. Latest observation 2026-10-05, `stale:false`.
- **Fillup integrity:** 60 rows before and after, content hash identical, 0 baseline columns populated (historical savings
  resolve dynamically from `FuelPriceSnapshot`; old fill-ups are **not** back-filled).
- **Savings coverage (account with 23 fill-ups):** 2 of 23 compared before the backfill → **21 of 23** after (19 regular,
  2 premium); the 2 no-grade fills stay excluded; negative savings remain visible; no hardcoded fallback; every comparison uses
  the EIA week on or before the fill date (0–6 days) for the same grade.
- **Cron:** the daily `fuel-price-snapshot` job keeps the table current (idempotent; 502s only if EIA is unreachable or stale).
