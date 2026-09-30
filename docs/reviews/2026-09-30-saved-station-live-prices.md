# ChatGPT Review Packet — Saved stations show current prices

**Status:** READY FOR REVIEW · 2026-09-30 · Claude Code

## 1. Objective

Don (paraphrased): saved/favorited gas stations display prices that may be several weeks old. That's
unacceptable. Saving a station should save the station's identity/location, not freeze its price.
Whenever a saved station is viewed, GasCap must show the latest available price from the same
current-pricing source used elsewhere in the app, the user must be able to tell how recently it was
updated, and stale pricing must never be silently presented as current. Treated as P0 ahead of a
partner demo on Mon 2026-10-05.

## 2. Repository State

- **Branch:** `fix/saved-station-live-prices`
- **Review Target SHA:** `97e6c84`
- **Packet Commit SHA:** the commit that adds this file (expected to differ from the target; docs only)
- **Base branch:** `main` @ `4552cea`
- **Relevant PR:** see PR opened from this branch
- **Review this diff:** `git diff --name-status origin/main...97e6c84` (output in §10)

## 3. What I Found

Before the change, four defects combined:

1. **Price frozen at save.** `FavoriteStation.prices` (`prisma/schema.prisma:626`, "FuelPrice[] snapshot")
   was written once by `POST /api/favorites` and never refreshed. `GET` returned the rows verbatim.
2. **Timestamp was the save time, not the price time.** Both the client (`NearbyStations.tsx`, the
   optimistic favorite) and the server (`POST`) set `priceUpdatedAt = new Date()`. A price Google last
   observed days earlier was labelled "Saved price · just now", so the age label under-reported
   staleness from the moment of saving.
3. **Contradictory UI.** After a search, the Favorites section (the old snapshot) rendered above a
   fresh `StationCard` for the same `placeId`. Search results were never merged into favorites.
4. **Service-worker cache.** `/api/favorites` wasn't in the next-pwa NetworkOnly list, so it fell
   into the default `apis` NetworkFirst cache (10 s network timeout, then cache fallback). This is
   the same class as the `/api/vehicles` bug fixed 2026-08-25.

Also: tapping a favorite's price chip pushed the stale price straight into the calculator.

**Root cause:** a deliberate shortcut, documented in a code comment: "Last-known price + timestamp,
not a live re-fetch." `lib/nearbyGas.ts` only had a radius search (`places:searchNearby`), and a
saved station may be nowhere near the user, so the search couldn't be reused to refresh it.

**Differs from assumption:** the ticket suspected indefinite caching. The main cause was the
persisted snapshot. Caching (the SW) was a secondary contributor. The existing nearby-search
in-memory cache (30 min) was not the cause.

## 4. What I Changed

| File | Before | After |
|---|---|---|
| `lib/nearbyGas.ts` | Radius search only; price parsing inline | Price parsing extracted to `parseFuelPrices()` and shared by search + details. New `fetchStationPrices(placeIds)` calls Place Details `GET /v1/places/{id}` with `X-Goog-FieldMask: id,fuelOptions`, keeps a per-placeId 30-min in-memory cache (successes only), and uses an 8 s timeout. Result per id: `FuelPrice[]` (Google answered, possibly `[]`) or `null` (unknown: no key, HTTP error, timeout). |
| `lib/fuelPriceFreshness.ts` (new) | — | `freshestPriceTime(prices)`: the latest Google `updateTime`, or null. Pure and client-safe, because `nearbyGas.ts` is server-only. Re-exported from `nearbyGas`. |
| `app/api/favorites/route.ts` GET | JWT user id; rows returned verbatim | Plan comes from the DB via `getLivePlan()`. Live lookup runs only if Pro, `ENABLE_LIVE_FUEL_PRICES==='true'` and the key is present. Each favorite returns `prices`, `priceUpdatedAt` (Google's time) and `priceStatus` (see below). A live success writes the snapshot back. The response is `Cache-Control: no-store`. |
| `app/api/favorites/route.ts` POST | `priceUpdatedAt = now` | `priceUpdatedAt = freshestPriceTime(prices)`; `prices` coerced to an array |
| `components/NearbyStations.tsx` | "Saved price · X"; always applicable; loaded once on mount | Labels are "Updated X" (teal; amber if Google's time is >24 h), "Couldn't refresh · last seen X" (amber, prices muted), or "No current price available". A non-live price >24 h old can't be applied. Search results merge into matching favorites. Favorites are re-fetched with `cache:'no-store'` whenever the tab becomes active. |
| `next.config.js` | `/api/favorites` went through the `apis` cache | Added to the NetworkOnly predicate and excluded from `apis` (inline literals, per the existing serialization warning) |
| `lib/translations.ts` | `savedPriceAsOf` EN/ES | `favPriceUpdated`, `favPriceLive`, `favPriceLastKnown`, `favPriceUnavailable` in both EN and ES; `savedPriceAsOf` removed (no other references) |
| `app/help/page.tsx`, `app/api/ai/chat/route.ts` | Described "last-known price + timestamp" | Describe the live lookup, the update label and the "Couldn't refresh" fallback |

`priceStatus` decision table in `GET`:

| Live lookup result | Stored snapshot | Returned |
|---|---|---|
| non-empty prices | any | `live`, live prices, Google time, snapshot written back |
| `[]` (Google reports none) or `null` (failed) or live disabled | has prices | `last_known`, snapshot, `freshestPriceTime(snapshot) ?? row.priceUpdatedAt` |
| same | empty | `unavailable`, `[]`, `null` |

## 5. Architectural Decisions

- **Resolve on read, server-side (chosen)** vs. background cron refresh vs. client-side per-station
  calls. Refresh-on-view guarantees freshness exactly when it matters. A cron would spend Google
  quota on favorites nobody opens. Client-side calls would expose the key or need a new proxy anyway.
- **Place Details by placeId** instead of re-running `searchNearby` around each favorite's
  coordinates. Details is exact (one station) and doesn't depend on ranking or radius. It also can't
  pull in unrelated stations.
- **Keep the `prices` column as a fallback, with write-back**, rather than dropping it. This needs
  no schema change or migration. When Google is down, the user still sees the last price, but it's
  explicitly flagged and carries its true age.
- **`[]` from Google → `last_known`, not "no price".** If Google stops reporting a price, the
  last-seen price with its age is more useful than a blank. It's still clearly not current.
- **Legacy rows:** `priceUpdatedAt` held the save time. The fallback prefers the Google `updatedAt`
  embedded in each stored `FuelPrice`, so old favorites show their real (older) age rather than the
  flattering save time.
- **24 h threshold** for disabling one-tap apply of non-live prices, and for amber-labelling live
  prices whose Google `updateTime` is old. It matches the 24 h community-report window
  (`app/gas/community-prices/route.ts`), based on roughly daily pump price changes.
- **Gate on the DB plan** (`lib/serverPlan.ts`), per CLAUDE.md. The sibling `/gas/nearby` route
  still uses the JWT plan; left unchanged here (out of scope).

## 6. Security Impact

- **Authorization changed for GET:** the user id now comes from `getLivePlan()` (session → DB lookup)
  instead of the raw session id. An unauthenticated request still gets 401. A new server-side Pro
  gate (from the DB) guards the paid Google call. Previously `GET` had no plan check, but it made no
  paid calls either.
- The Google API key stays server-side. `placeId` values come from the user's own DB rows and are
  `encodeURIComponent`-ed into the URL path. They are never taken from the request.
- `POST` still accepts client-sent `prices` (unchanged trust model; user-scoped, and superseded by
  live data on the next GET). A forged price could only mislead the forging user, and only when the
  live lookup fails.
- No secrets logged. Error logs include the HTTP status and placeId only.

## 7. Data / Database Impact

No schema change and no migration. `GET` now **writes**: on a successful live lookup it updates that
row's `prices` and `priceUpdatedAt` (additive refresh of an existing fallback cache, scoped to the
requesting user's rows). No destructive operations. Existing rows need no backfill; they're
corrected on their next view.

## 8. User / Business Impact

- Pro users with favorites (max 3 each) see current prices with honest ages. Free users are
  unaffected (favorites UI is Pro-only).
- **Cost:** each favorite view can trigger up to 3 Place Details calls at the **Enterprise +
  Atmosphere** SKU (`fuelOptions`). This is bounded by the 30-min per-station cache and the 3-favorite
  cap. Unit price should be confirmed in GCP billing.
- `GET /api/favorites` latency grows by one parallel round-trip to Google on a cache miss (≤ 8 s
  worst-case timeout). The favorites list renders after that response. The previous list stays on
  screen during tab re-activation re-fetches.
- No native rebuild needed (the hosted web app + SW is what the shells load).

## 9. Testing Performed

```
npm test          → Test Files 109 passed (109); Tests 1817 passed (1817)
npx tsc --noEmit   → clean (no output)
npm run build      → success; compiled public/sw.js contains both /api/favorites rules
```

Other tests:
- New `__tests__/savedStationLivePrices.test.ts`: 15 tests. **Run against the pre-fix code first:
  13 failed, 2 passed.** The 2 that passed are guards that hold either way (flag-off → no Google
  call; unauthenticated → 401). After the fix: 15/15.
- The existing `__tests__/nearbyGas.test.ts` (7 tests) passes unchanged after the parsing refactor.
- Provider-contract: the Place Details mocks follow Google's current documented shape. It's a
  top-level `Place` object (not `places[]`), with an unprefixed field mask and `fuelPrices[].price`
  as `{currencyCode, units: string, nanos}` plus `updateTime`. Doc checked 2026-09-30:
  developers.google.com/maps/documentation/places/web-service/place-details. Tests cover a positive
  real-shape path, `fuelOptions` with empty `fuelPrices`, 403, network timeout, no API key, and cache
  reuse.
- **Not performed:** no browser/UI run and no live Google call. There's no Places key locally, and
  the local env may point at a shared DB. A **read-only live smoke test is required after deploy**:
  load Find Gas on a Pro account with favorites and compare each favorite with its station card and
  Google Maps.

## 10. Files Changed

```
A	__tests__/savedStationLivePrices.test.ts
M	app/api/ai/chat/route.ts
M	app/api/favorites/route.ts
M	app/help/page.tsx
M	components/NearbyStations.tsx
A	lib/fuelPriceFreshness.ts
M	lib/nearbyGas.ts
M	lib/translations.ts
M	next.config.js
```
(9 files changed, 582 insertions(+), 48 deletions(-))

## 11. Known Risks / Remaining Questions

- **"Live" = Google's latest, not ground truth.** Google's own `updateTime` for a station can be
  days old. The UI labels that age and turns amber past 24 h, but it can't make the data fresher.
  Community reports (24 h) aren't yet merged into favorites.
- **Write-on-GET.** `GET` performs DB updates (awaited, errors swallowed and logged). It's
  idempotent, but it means a read endpoint mutates rows.
- **In-memory caches are per-instance.** This is fine on the single Railway instance, but the
  details cache is not shared if the app scales out.
- **`[]` from Google while a snapshot exists → `last_known`.** If a station genuinely stopped
  selling a grade, its old price lingers (flagged) until the station is removed.
- **Legacy snapshots whose embedded `FuelPrice.updatedAt` is null** fall back to the save-time
  `priceUpdatedAt`, which still under-reports age for those rows (flagged `last_known` either way).
- **Process note:** my first help-page edit introduced unescaped `'` inside a single-quoted string.
  `tsc` caught it; fixed with typographic apostrophes before commit.
- A separate pre-existing issue found during the audit (not fixed here): the `searchNearby`
  cache key rounds to 0.1° (~11 km). A cache hit returns the first requester's `distanceMi` values
  and search circle, so distances can be wrong for a second search elsewhere in the same cell.
  Planned as a separate PR.

## 12. Claude's Assessment

**READY FOR REVIEW.** The behaviour matches the acceptance criteria, it's covered by fail-first
regression tests, and all three required checks pass. A post-deploy live smoke test is the one
remaining verification.

## 13. Questions for ChatGPT

1. Is resolving on GET (with write-back) the right place, or should the snapshot write-back be
   dropped so the GET is side-effect-free? What failure mode would each choice produce?
2. When Google returns `fuelOptions` with empty `fuelPrices` for a favorite that has a snapshot, is
   `last_known` (show the old price, flagged) better than `unavailable` (show nothing)?
3. Is the 24 h threshold for disabling calculator-apply of non-live prices appropriate, or should
   any non-live price be non-applicable?
4. Does `getLivePlan()` fully cover Lifetime users? They're stored as `plan='pro'`; the helper also
   accepts `'lifetime'`/`'fleet'`.
5. Any concern with `Promise.all` over up to 3 Place Details calls (8 s timeout each) blocking the
   favorites response, versus returning identity immediately and streaming prices?
6. Does the test for the service-worker rule (a source-text assertion on `next.config.js`) give
   enough protection, given the known workbox serialization pitfall?

## 14. Requested Review Scope

Highest scrutiny:
1. `app/api/favorites/route.ts` `GET`: the `priceStatus` decision table, the Pro/flag gating, and the
   write-back.
2. `lib/nearbyGas.ts` `fetchStationPrices` / `fetchOneStationPrices`: whether it matches Google's
   contract, the null-vs-`[]` semantics, and the caching.
3. `components/NearbyStations.tsx`: the merge-from-search logic and the `canApply` / label logic.

Lower priority: translations, help/AI copy, `next.config.js` (mirrors the existing pattern).
