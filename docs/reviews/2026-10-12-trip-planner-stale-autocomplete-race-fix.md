# ChatGPT Review Packet — Trip Planner Stale-Autocomplete Race Fix

## 1. Objective

Don authorized a focused corrective PR after a prior audit cycle confirmed
the root cause of a user-reported Trip Planner anomaly (an Orlando→Atlanta
trip showing ~20 hours of driving and a false "you have enough fuel" claim):
a real async race condition in `selectOriginSuggestion`/`selectDestSuggestion`
in `components/TripCostEstimator.tsx`. The audit explicitly ruled out the
Google Routes API, a lat/lng coordinate swap, and the Favorite-Address path
as explanations via live reproduction against the real Google Routes API.
The authorization scoped this PR to: a staleness guard for autocomplete
selection, Calculate-button protection against calculating mid-resolution,
deterministic regression tests proving the exact race, duration-formatting
test coverage (previously untested), and a documented-only (not implemented)
assessment of whether the fuel-sufficiency/duration copy itself should be
hardened independent of this fix. Stop before merge; return to Don and
ChatGPT for independent review.

## 2. Repository State

- **Branch:** `fix/trip-planner-stale-autocomplete-race`
- **Review Target SHA:** `5861943` (the fix commit; see `git log -1`)
- **Packet Commit SHA:** this file is added in a separate commit on the same
  branch, after the Review Target SHA.
- **Base branch:** `main`
- **Relevant PR:** [dparker001/gascap#84](https://github.com/dparker001/gascap/pull/84)
- **Review this diff:** `git diff --name-status 6053a7f...5861943`

```
A	__tests__/latestWinsGuard.test.ts
A	__tests__/placeLocationClient.test.ts
A	__tests__/placeSelectionResolver.test.ts
A	__tests__/tripDurationFormatting.test.ts
M	components/TripCostEstimator.tsx
A	lib/latestWinsGuard.ts
M	lib/mapsProvider/googleMapsProvider.ts
A	lib/placeLocationClient.ts
A	lib/placeSelectionResolver.ts
```

9 files changed, 557 insertions(+), 25 deletions(-).

## 3. What I Found

`selectOriginSuggestion`/`selectDestSuggestion` (pre-fix) each ran: set the
displayed text and placeId synchronously, clear suggestions, then `await` a
`fetch('/api/maps/place-location', ...)` and call `setOriginCoords`/
`setDestCoords` unconditionally if the response was ok — with no check that
this was still the most recently selected suggestion for that field. Nothing
invalidated an in-flight lookup on a later selection, a manual edit, clearing
the field, or switching to Current Location / a saved favorite. A directly
analogous "latest wins" generation-counter pattern already existed inline in
`components/NearbyStations.tsx` (`fetchGenRef`/`geoGenRef`), confirming this
is a known, previously-solved problem class in this codebase that simply
wasn't applied here. `lib/mapsProvider/googleMapsProvider.ts`'s `parseDuration`
and the component's `formatDuration` were both local, unexported functions
with zero test coverage.

## 4. What I Changed

- **`lib/latestWinsGuard.ts`** (new): `createLatestWinsGuard()` — `begin()`
  issues a token and invalidates every previous one; `isCurrent(token)`
  checks whether a token is still the latest; `invalidateAll()` invalidates
  without starting a new operation (manual edit / clear / mode switch /
  unmount).
- **`lib/placeSelectionResolver.ts`** (new): `resolveSelectedPlace(guard,
  fetchCoords, apply)` — begins a token, awaits the coordinate fetch, and
  calls `apply` only if the token is still current and the fetch succeeded.
  A failed/null fetch never calls `apply` (nothing to "restore").
- **`lib/placeLocationClient.ts`** (new): `fetchPlaceCoordinates(placeId,
  sessionToken?)` — extracts the `POST /api/maps/place-location` fetch that
  was byte-for-byte duplicated in both select-suggestion handlers; returns
  `null` on any failure.
- **`components/TripCostEstimator.tsx`**:
  - Added `originGuard`/`destGuard` (`useRef(createLatestWinsGuard())`),
    `originInFlight`/`destInFlight` (`useRef(0)`), `originResolving`/
    `destResolving` (`useState(false)`), and an unmount-cleanup `useEffect`
    that invalidates both guards.
  - `originGuard.current.invalidateAll()` / `destGuard.current.invalidateAll()`
    added as the first statement in: `handleUseCurrentLocation`,
    `handleOriginBackToManual`, `handleSelectOriginFavorite`,
    `handleDestBackToManual`, `handleSelectDestFavorite`, both manual
    `onChange` handlers, and both clear-("×") `onClick` handlers.
  - `selectOriginSuggestion`/`selectDestSuggestion` rewritten to call
    `resolveSelectedPlace()` with `fetchPlaceCoordinates()`, tracking
    in-flight count to drive `originResolving`/`destResolving`.
  - `handleRouteCalculate` now returns immediately (no-op) if
    `originResolving || destResolving`; the Calculate button is also
    visually disabled and shows the resolving state in that case.
  - Behavior before: a stale lookup could silently overwrite the current
    field's coordinates after the user had already moved on, with the
    address TEXT still showing the user's actual intended selection — the
    route would calculate against the wrong, invisible location.
  - Behavior after: only the most recent selection's lookup can ever apply
    its coordinates to state; every other field interaction invalidates any
    pending lookup; Calculate cannot run while a lookup is still pending.
- **`lib/mapsProvider/googleMapsProvider.ts`**: `parseDuration` exported
  (was local/unexported); no behavior change.
- **`components/TripCostEstimator.tsx`**: `formatDuration` exported (was
  local); no behavior change.

## 5. Architectural Decisions

- **Extracted pure functions instead of a direct in-component fix.** This
  codebase has no JSX render harness (per `CLAUDE.md`'s testing conventions),
  so UI-embedded async logic can't be unit-tested directly inside the
  component. Extracting the guard primitive and the resolve-on-select
  sequence into plain TypeScript functions makes the exact fix — not just
  the underlying generation-counter idea — directly testable with
  controllable (deferred) promises, which is the only way to reliably
  reproduce a specific completion order for a race condition in a test.
- **Independent guards per field, not one shared guard.** Origin and
  destination lookups are legitimately concurrent and unrelated; a shared
  guard would make resolving one field spuriously invalidate the other.
  Verified by test scenario 7 in `placeSelectionResolver.test.ts`.
- **In-flight counter is separate from the guard.** The guard alone answers
  "should this result apply," but the UI also needs to know "is anything
  still pending" (to disable Calculate) even when the pending thing is
  itself stale and about to be discarded. A counter that increments on
  start and decrements in a `finally` (regardless of staleness) gives an
  accurate "still waiting on something" signal without conflating it with
  "which result is valid."
- **Calculate is blocked, not silently correct-by-fallback.** `resolveWaypoint()`
  already falls back to the typed address text when `originCoords`/
  `destCoords` is `undefined`, so calculating mid-resolution would not have
  reproduced the original bug (it predates coordinates existing at all,
  rather than overwriting them late). But it would silently use a less
  precise geocode of the text string when more precise coordinates were
  about to arrive a moment later, with no indication to the user that the
  numbers might change if they wait. Blocking Calculate during resolution
  was chosen over allowing-with-fallback for that reason.

## 6. Security Impact

No security problems fixed or introduced by this change — it is a client-side
UI state-consistency fix with no effect on authentication, authorization, or
any server-side trust boundary. `/api/maps/place-location` and
`/api/maps/route` are unchanged. No security impact.

## 7. Data / Database Impact

No database or production-data changes. No schema changes, migrations, or
backfills.

## 8. User / Business Impact

Fixes a real-world case of a Pro-gated feature (route-based Trip Planner)
producing a materially wrong result (wrong distance → wrong duration → wrong
"do I need to stop for gas" answer) that a user could act on while driving.
No pricing, entitlement, or plan-tier logic is touched. No visible UI change
for the non-racing happy path; the only new user-visible behavior is the
Calculate button briefly showing a "resolving" state in the rare window where
a Place Details lookup is still in flight, and that same spinner state
disabling Calculate during that window.

## 9. Testing Performed

```
npm test          → 184 test files passed, 3187 tests passed, 5 skipped (3192)
npx tsc --noEmit  → clean, no errors
npm run build     → succeeded
```

Other tests: the 10 new `placeSelectionResolver.test.ts` scenarios were run
twice — once against the committed, guarded implementation (10/10 pass), and
once against a locally-reverted, intentionally-unguarded version of
`resolveSelectedPlace` (not committed; restored immediately after, diff
verified identical to the committed version post-restore) to prove the
tests actually detect the race rather than only exercising happy paths.
**Exactly 8 of 10 failed** against the unguarded version, confirmed with
`--reporter=verbose` test-by-test output (not just the pass/fail summary
count): scenarios 1, 2, 4, 5, 6, 7, 9, and 10 failed unguarded, as expected.
Scenarios 3 and 8 passed even unguarded — both exercise "a failed/null
lookup never calls apply," which is true regardless of staleness guarding
(there is no coordinate to incorrectly apply either way), so their passing
unguarded is correct and expected, not a gap in coverage.

## 10. Files Changed

```
A	__tests__/latestWinsGuard.test.ts
A	__tests__/placeLocationClient.test.ts
A	__tests__/placeSelectionResolver.test.ts
A	__tests__/tripDurationFormatting.test.ts
M	components/TripCostEstimator.tsx
A	lib/latestWinsGuard.ts
M	lib/mapsProvider/googleMapsProvider.ts
A	lib/placeLocationClient.ts
A	lib/placeSelectionResolver.ts
```

## 11. Known Risks / Remaining Questions

- **Real-device/real-network confirmation not performed.** All race
  scenarios are proven with controllable deferred promises, not a live
  device typing quickly in the actual autocomplete field against the real
  Google Places API. The unit-level proof is strong, but an on-device replay
  of the original Orlando→Atlanta report was not re-attempted post-fix
  (the original report could not be deterministically reproduced live even
  during the audit — it was diagnosed by code inspection plus a live Routes
  API call for the *correct* numbers, not by reproducing the race itself
  live, since the race depends on human typing/clicking timing).
- **Calculate-block UX reuses the existing `calculatingRoute` copy** rather
  than new copy explaining *why* it's disabled (resolving the address, not
  routing). This was a scope call to avoid touching
  `lib/translations.ts` EN/ES copy in a PR scoped to the race fix; worth a
  follow-up if Don wants the distinction visible to users.
- **Fuel-safety-copy hardening was assessed, not implemented** — see
  Appendix A below, included per the authorization's explicit requirement
  to document (not build) this.

## 12. Claude's Assessment

**READY FOR REVIEW.** The race is real, the fix is narrowly scoped to the
confirmed defect, all three gates pass, and the regression tests were
verified (with one count-precision caveat noted above, not a correctness
concern) to fail pre-fix and pass post-fix. Not merged — awaiting
independent review and Don's authorization per the standing process.

## 13. Questions for ChatGPT

1. Is `invalidateAll()` on manual-edit/clear/mode-switch sufficient, or
   should the guard also expose a narrower `invalidateIfDifferent(key)` to
   avoid invalidating a lookup that's about to resolve to the exact same
   place the user re-selected (scenario 10 shows this is *handled correctly*
   today — a redundant lookup still runs and still wins — but is it worth
   short-circuiting for cost/latency rather than correctness)?
2. Does disabling Calculate during resolution, versus allowing it with the
   existing text-fallback, strike the right balance? The existing fallback
   is itself safe (never combines mismatched coordinates/text), so blocking
   is a UX choice, not a correctness requirement — does that reasoning hold?
3. Is the Appendix A fuel-safety-copy recommendation (add a route-confidence
   hedge only when the distance came from a fallback/geocode rather than
   precise coordinates, rather than hedging the copy universally) the right
   scope, or does ChatGPT see a cheaper or more robust alternative?

## 14. Requested Review Scope

Give the most scrutiny to:
1. `lib/placeSelectionResolver.ts` and its 10 test scenarios — this is the
   actual fix; the two call sites in `TripCostEstimator.tsx` just wire it up.
2. The invalidation call-site list in §4 — confirm nothing that should
   invalidate a pending lookup was missed (the diff in
   `components/TripCostEstimator.tsx` is the place to check against the
   8 required trigger types from the authorization).
3. Appendix A's fuel-safety-copy assessment — this is a recommendation, not
   code; the review value is in judging whether the scoping is right before
   any implementation is authorized.

---

## Appendix A — Fuel-Safety-Copy Hardening Assessment (documented only, NOT implemented)

**Per the authorization's Part 5, this is an assessment only. No code in
this PR changes any user-facing fuel-sufficiency or duration copy.**

### Current copy and where it lives

- `lib/tripFuelPlanner.ts:237` — `calcTrip()`'s summary string: `"Great news
  — you already have enough fuel for the full {miles}-mile trip!"` when
  `gallonsNeeded === 0`.
- `lib/translations.ts` (`enoughFuelTitle`, EN ~line 2778 / ES ~line 6347) —
  `"You have enough fuel for the whole trip!"` card title shown in the Trip
  Planner result UI.
- Neither string carries any caveat about the *distance* input's provenance
  or confidence — they're worded as if `miles` is known-exact.

### Is `calcTrip()` itself the bug?

No. `calcTrip()` is pure arithmetic over whatever `miles`/`mpg`/`tankGal`/
`fuelPct` it's given, and given a correct `miles` value, `gallonsNeeded === 0`
is the correct condition for "enough fuel" — verified by
`__tests__/rentalFuelNeededCalculatedGate.test.ts` and the broader
`calcTrip` test coverage, none of which changed in this PR. The reported
false "enough fuel" claim was a correct computation over a WRONG distance,
fed in by the race this PR fixes — not a flaw in the fuel math itself.

### Why harden the copy anyway, if the root cause is fixed?

This PR closes the *specific* mechanism that produced the wrong distance.
It does not make the Trip Planner's distance input provably correct under
every future failure mode — a few other ways a wrong distance could still
reach `calcTrip()` and still render as a confident "you have enough fuel":

- `/api/maps/route` returning a cached or stale result from Google (outside
  this codebase's control).
- A future regression that reintroduces an unguarded async path elsewhere
  (e.g., a new input surface added without using `resolveSelectedPlace`).
- `resolveWaypoint()`'s documented, disputed, user-visible fallback path
  (geocoding typed text when a favorite's coordinates can't be resolved) —
  already surfaced via `usedFavoriteFallback`, but the fuel-sufficiency copy
  itself doesn't currently reflect "this distance came from a fallback
  geocode, not a precise lookup."

### Recommended scope (if Don authorizes a follow-up)

Narrow, not universal: add a hedge to the "enough fuel" / duration copy
**only** when the active trip's distance did not come from precise,
resolved coordinates on both ends — i.e., when `usedFallback` was true for
either waypoint, or (for manual-text mode) neither end has photo-confirmed
coordinates. In that specific case, append something like: *"Estimated
route — exact distance may vary."* In the normal case (both ends resolved
via Place Details or precise current-location/favorite coordinates), leave
the confident copy as-is; it has test coverage, matches the architecture's
"don't invent a reading" philosophy from `CLAUDE.md`'s Rental Return
section, and a universal hedge would needlessly undermine user trust in the
common, actually-reliable case.

### What this would require if authorized

- New EN + ES translation keys (`lib/translations.ts`), checked per
  `CLAUDE.md`'s "check both EN and ES on every content change" rule.
- A new boolean threaded from `handleRouteCalculate`'s existing
  `usedFallback` tracking into whatever renders the summary/title, or a
  small `TripResult` field addition in `lib/tripFuelPlanner.ts` (would
  require regression tests per `CLAUDE.md`'s "changes to fuel calculations
  require regression tests" rule, even though the arithmetic itself isn't
  changing — the rule is written broadly enough to cover this).
- Updates to `app/help/page.tsx` and the `APP FEATURES` block in
  `app/api/ai/chat/route.ts` per the standing "after every user-facing
  feature change" rule, since this changes what the assistant should say
  about trip-distance confidence if asked.

**Recommendation: worth doing, but as its own separate, small PR — not
bundled into this race fix.** Flagging for Don's explicit authorization
before any implementation.
