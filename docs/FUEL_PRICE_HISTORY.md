# Fuel-price history & savings baseline

**Status: CURRENT** — implemented in Phase 0.5B (2026-10-07), branch
`feat/gascap-daily-phase05`. Not yet deployed at the time of writing; see
`docs/reviews/2026-10-07-gascap-daily-phase05.md`.

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
