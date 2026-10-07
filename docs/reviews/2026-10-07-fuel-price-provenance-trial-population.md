# ChatGPT Review Packet — Price provenance + trial population (follow-up to PR #65)

Template: `docs/reviews/CHATGPT_REVIEW_PACKET_TEMPLATE.md`. Small, isolated; found by
post-deployment verification of PR #65. Risk: MEDIUM (user-visible price labelling; admin metric).

## 1. Objective
Correct two data-integrity defects found after Phase 0.5 deployed, **before** the 156-week backfill and
before any Phase 1 decision: (1) a national/regional EIA fallback being cached and reported as a state's
live price; (2) the historical trial population being understated. No Phase 1 work, no backfill.

## 2. Repository State
- **Branch:** `fix/fuel-price-provenance-trial-population` (from `origin/main` @ `37e58ac`, the PR #65 merge).
- **Base:** `main` @ `37e58acb40438cd576cbc3e1a7680bbbbca7b0b1`
- **Review Target SHA / Packet Commit SHA:** see the PR (packet commit follows the code commit).
- **Diff:** `git diff --name-status origin/main...HEAD`

## 3. What I Found
**Price.** Production returned `{state:"FL", price:4.354, priceSource:"eia_live"}`. 4.354 = national Regular;
Florida's `SFL` = 3.97 (California returned its correct state value 6.227). `fetchStateLive()` walks
state→region→national but returned only `{price, period}`; `getStatePrice()` cached it under the requested
state key. Contributing factor, measured: EIA latency ranges 0.5 s → >30 s, and the per-request timeout was
7 s, so routine slowness became a silent national-for-state fallback pinned for 6 h. The old
`GasPriceLookup` then printed "Florida weekly avg" beside a national number. Also: every request that found
an expired cache started its own background refresh (no in-flight guard).
**Trials.** `trialsEver` = `trial_started` users ∪ trial-column users, ignoring `trial_expired`, which is
already loaded. Production: 350 signups, 71 "trials", yet 122 `trial_expired` rows (122 distinct real users).
An ended trial has its columns cleared, so only the expiry event still evidences it.

## 4. What I Changed
| File | Change |
|---|---|
| `lib/eiaAreas.ts` | `scopeForArea()` (`SFL`→state, `R1Z`→region, `NUS`→national, else null) |
| `lib/gasPrices.ts` | `resolveStateLive()` returns `{price, period, area, scope}`; cache keeps area/scope; `StatePrice` gains `area`/`scope`; fallback results cached 10 min (best-series 6 h); timeout 7→20 s; one in-flight refresh per state |
| `app/api/gas-price/route.ts` | adds `priceArea`, `priceScope`, `priceFallback`; snapshot path preserves real area; `isState`/`isNational` describe the price when provenance is known (seed keeps old meaning) |
| `components/GasPriceLookup.tsx`, `lib/translations.ts` (EN+ES) | label by scope; "Regional weekly avg"; remembered note no longer says "<State> avg" for a fallback |
| `lib/engagementBaseline.ts`, `EngagementBaselinePanel.tsx` | trial population = distinct real users in (`trial_started` ∪ `trial_expired` ∪ trial columns); `trialDefinition` now `{byTrialStarted, byTrialExpired, byTrialColumns, union}` |
| tests, `docs/FUEL_PRICE_HISTORY.md` | see §9 |

## 5. Architectural Decisions
- **Short TTL for fallbacks** rather than refusing to cache them: a fallback is still better than the stale
  seed, but must not outlive the timeout that caused it. Alternative rejected: never cache fallbacks (hammers EIA).
- **`isState`/`isNational` redefined to describe the price** (when known) rather than adding only new fields:
  leaving them request-based would keep the exact mislabel. Cost: a semantic change for a boolean; the only UI
  consumer was updated and old fields are all still present.
- **Seed carries `area/scope = null`** — its per-state provenance was never recorded; inventing one would repeat the bug.
- **No change to `FuelPriceSnapshot`**: it already stores the real `duoarea`.
- **Trial union uses distinct user ids**, never event-row counts; test/admin/deleted users are excluded by the
  existing loader scope + `inPop()`.

## 6. Security Impact
No security impact. No auth/authorization change; admin route and loader unchanged apart from a metric definition.

## 7. Data / Database Impact
No database or production-data changes. No migration, no backfill. Production was read **read-only** (aggregates) for the before/after.

## 8. User / Business Impact
Users in a state whose own EIA series is slow/unavailable will see "Regional/National weekly avg" instead of a
mislabelled state price, and the app retries the state series within 10 minutes. Admin "Trials ever" rises
71 → 127; "Trials currently paid" falls 1.4% → 0.8% (1/127). No pricing, entitlement, giveaway or notification change.

## 9. Testing Performed
```
npm run check:crons → 22 routes, 20 scheduled, 2 exempt
npm test            → 162 files, 2703 passed (PR #65 base: 2665 / 161)
npx tsc --noEmit    → exit 0
npm run build       → exit 0
```
38 net-new tests. Against the pre-fix code (scratch worktree at `origin/main`) **37 of the new/changed tests fail**.
Provenance: direct state / region fallback / national fallback / national-never-masquerades / cache preserves
provenance / cached fallback keeps scope / fallback TTL retry / best-series long TTL / seed labelled / snapshot
keeps real area / backward-compatible fields / in-flight dedupe. Trials: expired-only, started-only,
column-only, all-three-counted-once, never-trial, duplicate rows, duplicate ids, test/admin/deleted excluded,
converted-then-cancelled, real-world shape (120 expired vs 1 started).
**Live EIA (read-only, key not printed):** FL→SFL 3.97 state; CA→SCA 6.227 state; GA→R1Z 3.959 region;
AK→R50 5.727 region; US→NUS 4.354 national; **forced** `SFL` failure→R1Z 3.959 region; forced `SFL`+`R1Z`
failure→NUS 4.354 national — all dated 2026-10-05, each fallback correctly labelled.
**Limits:** no authenticated UI run (still no signed-in session); the 10-min retry and 20 s timeout are
reasoned + unit-tested, not observed over time in production.

## 10. Files Changed
Generated mechanically in the PR (`git diff --name-status origin/main...HEAD`).

## 11. Known Risks / Remaining Questions
1. **Trial population is still a lower bound.** `trial_expired` events only begin 2026-08-30 and `trial_started`
   earlier than that is partial; trials that ended before instrumentation have neither event nor columns. 350
   signups vs 127 evidenced trials. Treat 127 as a floor, not a count.
2. The one purchase event occurred ~31 s after signup (RevenueCat Lifetime) — likely an owner/test purchase on an
   unflagged account; real conversion is effectively unproven. (Unchanged; Stripe test-mode filtering still open.)
3. `isState`/`isNational` semantic change (§5).
4. In-memory cache is per process (as before): a redeploy resets it; the DB snapshot layer then covers cold starts
   **only after the backfill/cron has populated it**.
5. Open from PR #65, unchanged here: Rental Pilot flat $3.30/gal; stale seed (2026-06-23) not regenerated;
   `areaState` user-asserted and not for rewards; authenticated UI smoke test still outstanding.
6. Process: my first live Florida probe used a malformed shell loop and returned empty bodies; I re-ran it
   correctly before drawing the conclusion.

## 12. Claude's Assessment
**READY FOR REVIEW** — focused, tested, and the live provider behavior matches EIA exactly.

## 13. Questions for ChatGPT
1. Is a 10-minute fallback TTL + 20 s timeout the right trade-off, or should a fallback never be served as `live:true`?
2. Is redefining `isState`/`isNational` safer than leaving them and adding only `priceScope`?
3. Does the trial union double-count or omit any evidence source? Should `purchase_completed` users count as trials?
4. Any path where a regional/national value is still labelled state-specific (route, snapshot, UI, localStorage)?

## 14. Requested Review Scope
1. `lib/gasPrices.ts` (provenance, TTLs, in-flight map) · 2. `app/api/gas-price/route.ts` flag semantics ·
3. `lib/engagementBaseline.ts` trial union · 4. `components/GasPriceLookup.tsx`. Lower: docs, translations.
