# ChatGPT Review Packet — Pre-demo integrity fixes (PR #55)

**Status:** READY FOR REVIEW · 2026-09-30 · Claude Code

## 1. Objective

Don asked Claude to "start the four pre-demo fixes": items A2–A5 from the pre-meeting readiness
audit. The goal is a clean live demo for a partner meeting on Mon 2026-10-05. The four defects could
produce wrong, contradictory, or broken-looking output in front of a partner, and one of them (A4)
is also a paid-feature gating hole. The saved-station stale-price fix (A1) is a separate PR, #54,
with its own packet (`docs/reviews/2026-09-30-saved-station-live-prices.md`).

## 2. Repository State

- **Branch:** `fix/pre-demo-integrity`
- **Review Target SHA:** `3a5780f`
- **Packet Commit SHA:** the commit that adds this file (docs only; expected to differ from the target)
- **Base branch:** `main` @ `4552cea`
- **Relevant PR:** https://github.com/dparker001/gascap/pull/55 (sibling: #54)
- **Review this diff:** `git diff --name-status origin/main...3a5780f` (output in §10)

## 3. What I Found

All four were verified in the repository before any change. One audit claim was rejected (see the
end of this section).

- **A2 — Find Gas search cache served the first requester's distances.**
  - `lib/nearbyGas.ts` `cacheKey()` rounded lat/lng to 1 decimal (~11 km cells).
  - A cache hit returned `hit.stations` unchanged, including `distanceMi` computed from the
    **first** requester's coordinates, and that requester's 5-mile search circle.
  - For 30 min, a second search up to ~5 mi away got wrong distances and wrong ordering, and
    stations near the second searcher could be missing.
  - Realistic demo trigger: search at home, then at the venue.
- **A3 — AI assistant contradicted itself.**
  - `app/api/ai/chat/route.ts` `APP FEATURES`, line 144: "Starting a NEW rental requires Pro".
  - Line 149: "users don't need Pro to create a rental session".
  - The API (`app/api/rental-sessions/route.ts:40-44`) requires live Pro, so line 149 was wrong.
- **A4 — AI Pro gate trusted a client flag.**
  - `isSuggested = body.isSuggested === true || ALLOWED_SUGGESTED.has(question)`.
  - Any caller could send `isSuggested: true` with an arbitrary question and skip the Pro check,
    getting open-ended `claude-opus-4-5` answers without Pro. This is client-side gating, which
    `CLAUDE.md` prohibits.
  - **Discovered while fixing:** the hand-maintained `ALLOWED_SUGGESTED` held only the six English
    chips. The Spanish chips (`translations.es.ai.chips`) were never in it and were admitted *only*
    by the client flag. Simply removing the flag would have 403'd every Spanish-speaking free user
    who tapped a chip. The code comment "Must stay in sync with PROMPT_CHIPS in AiAdvisor.tsx" was
    already stale: the chips come from translations, not a local constant.
- **A5 — Rental "Find Gas Near Return" hid its failure states.**
  - `components/rental-return/FindGasNearReturn.tsx` called `r.json()` without checking `r.ok`.
  - It rendered any response with no priced stations as "No priced stations found near your
    return location".
  - `/gas/nearby` returns HTTP 200 + `stations: []` for Pro-gate refusals (`proRequired`), for live
    prices switched off (`disabled`), and for a missing key (`error`). It returns 500 +
    `stations: []` for lookup failures.
  - All of these looked like "no stations near the airport", including the common stale-JWT case
    right after an upgrade.

**Rejected audit claim:** a sub-agent reported that Lifetime members were excluded from AI chat and
price alerts because the gates check `plan === 'pro' || 'fleet'`. No code path assigns
`plan = 'lifetime'`; Lifetime members are stored as `plan = 'pro'`. Not acted on.

## 4. What I Changed

| Item | File | Before | After |
|---|---|---|---|
| A2 | `lib/nearbyGas.ts` | `cacheKey` 0.1°; hit returned stored stations as-is | `cacheKey` 0.01° (~1.1 km). New `withDistancesFrom(stations, lat, lng)` recomputes `distanceMi` from the **current** request and re-sorts on every cache hit. The miss path is unchanged (it already measured from the request). |
| A2 | `__tests__/nearbyGas.test.ts` | Comment described the 1-decimal key | Comment only; tests unchanged (whole-degree offsets still isolate cache keys) |
| A3 | `app/api/ai/chat/route.ts` | Line 149 "don't need Pro to create a rental session" | "starting a NEW rental requires Pro (every new signup gets a 30-day Pro trial)", matching line 146 and the API |
| A4 | `app/api/ai/chat/route.ts` | `ALLOWED_SUGGESTED` = 6 hard-coded English strings; client `isSuggested` bypassed the gate | `ALLOWED_SUGGESTED` is built from `Object.values(translations).flatMap(l => l.ai.chips)`: every language, the same source `AiAdvisor.tsx` renders from. `isSuggested` is ignored for gating (the field is kept in the type and documented as ignored). |
| A5 | `lib/nearbyResponse.ts` (new) | — | `classifyNearbyResponse(httpOk, body)` → `'ok' \| 'pro_required' \| 'disabled' \| 'error'` |
| A5 | `components/rental-return/FindGasNearReturn.tsx` | `r.json()` → always "done" | Checks `r.ok`, tolerates non-JSON bodies, classifies, and has distinct `pro_required` / `disabled` render states |
| A5 | `lib/translations.ts` | — | `rentalReturn.findGasProRequired`, `rentalReturn.findGasUnavailable` in EN **and** ES. Both state that the rental calculations still work; the Pro message tells a just-upgraded user to sign out and back in (the stale-JWT case). |

## 5. Architectural Decisions

- **A2: finer key + recompute on hit** (chosen) vs. (a) keep the 0.1° key and only recompute
  distances, or (b) key on exact coordinates.
  - (a) fixes distances but not the stale 5-mile *circle*: a search 5 mi away would still get the
    first searcher's station set.
  - (b) makes the cache nearly useless (GPS jitter), so every search is a paid `searchNearby`.
  - 0.01° bounds the circle-center offset to ≤ ~0.5 mi while still absorbing repeat taps and
    jitter. Recomputing on every hit makes the distances exact regardless.
- **A4: allowlist from translations** vs. a hand-maintained multi-language constant. Built from the
  single source the UI renders, so a future chip edit or a new language can't silently fall out of
  sync with the gate.
- **A4: exact text match** (after `trim()`, which matches what `AiAdvisor.sendMessage` sends).
  - Consequence: a free user who types a chip's exact text manually also gets through. That's
    harmless: the text is the same as tapping the chip.
- **A5: pure classifier in `lib/`** rather than inline logic, so it's unit-testable without a
  React test environment (the repo has none: vitest `environment: 'node'`, no Testing Library).
  `NearbyStations.tsx` has equivalent inline logic; it was deliberately **not** refactored onto the
  classifier in this PR (scope and demo risk).
- **A5: rental Pro gating unchanged.** "Find Gas Near Return" stays Pro-gated exactly as before;
  only the messaging changed. See §11 for the open policy question.

## 6. Security Impact

- **Fixed:** a server-side Pro gate (`/api/ai/chat`) can no longer be bypassed by a client-supplied
  flag. This closes unlimited open-ended AI access for guests and free users, which carried a direct
  Anthropic cost.
- **Authorization behavior:**
  - Only tightened. No user gains access. Custom questions still require a DB-resolved
    `pro`/`fleet` plan (unchanged lookup).
  - Suggested chips remain open to guests, free and Pro. The EN chips are unchanged; the ES chips
    move from flag-admitted to allowlist-admitted, so the net effect for legitimate users is none.
- **Not changed (pre-existing, still open):**
  - No rate limiting on `/api/ai/chat`: guests and free users can still send the six suggested
    chips without limit, and each is an Opus call.
  - The route returns `AI request failed: ${err.message}` to the client, which could echo provider
    error text.
  - The model is hard-coded as `claude-opus-4-5`.
  - All are follow-up candidates, deliberately out of scope before the demo.
- A2, A3 and A5 have no security impact. The new client error states don't reveal anything the
  existing responses didn't.

## 7. Data / Database Impact

No database or production-data changes. No schema changes, migrations, or writes.

## 8. User / Business Impact

- **Find Gas (all Pro users):** distances and ordering are correct for every search, not just the
  first in an ~11 km cell for 30 min.
  - Cost: finer cache cells mean more Google `searchNearby` calls. Each 0.1° cell becomes up to 100
    distinct 0.01° cells, but the real increase is bounded by how far users actually move between
    searches, not by area.
  - Google Places spend should be watched for the first week.
- **AI chat:** for free/guest users in EN and ES, suggested chips work exactly as before, and
  custom questions still 403 with an upgrade message. Only clients sending `isSuggested:true` with
  non-chip text are affected. `AiAdvisor.tsx` never does this: it only sets the flag on chip taps.
- **AI accuracy:** the assistant can no longer tell users a rental can be started without Pro.
- **Rental users:** instead of a misleading "no stations found", they see either a Pro message
  (including a sign-out/in hint for the stale-JWT case) or a "temporarily unavailable" message. Both
  confirm their rental calculations still work.
- No change to pricing, entitlements, native builds, email/push, or the sweepstakes.

## 9. Testing Performed

```
npm test          → Test Files 109 passed (109); Tests 1812 passed (1812)
npx tsc --noEmit   → clean (no output)
npm run build      → success
```

Other tests:
- **New `__tests__/preDemoIntegrity.test.ts`:** 10 tests. **Run against the pre-fix code first:
  7 failed, 3 passed.** The 3 are guards that should hold on both versions:
  - a free user asking an EN chip → 200
  - a free user asking every ES chip → 200 (passed before only because of the flag; now proves the
    flag's removal didn't lock ES users out)
  - a Pro user asking a custom question → 200

  After the fix: 10/10.
- **Combined with #54:** the two branches were test-merged in a scratch worktree. `lib/nearbyGas.ts`,
  `app/api/ai/chat/route.ts` and `lib/translations.ts` auto-merged without conflicts. On the merged
  tree, `npx tsc --noEmit` was clean and the suite passed: 110 files, 1827/1827
  (= 1802 base + 15 from #54 + 10 from #55).
- **CI (`verify`) on GitHub:** see the PR.
- **Not performed:** no browser/UI run and no live Google or Anthropic calls. There's no Places key
  locally, and the local env may point at a shared DB. Recommended post-deploy checks (read-only):
  - Two Find Gas searches ~2 mi apart within 30 min: compare distances against Google Maps.
  - Open an active rental's "Find Gas Near Return" on a Pro account.
  - Tap an ES chip as a free user.

## 10. Files Changed

```
M	__tests__/nearbyGas.test.ts
A	__tests__/preDemoIntegrity.test.ts
M	app/api/ai/chat/route.ts
M	components/rental-return/FindGasNearReturn.tsx
M	lib/nearbyGas.ts
A	lib/nearbyResponse.ts
M	lib/translations.ts
```
(7 files changed, 269 insertions(+), 18 deletions(-))

## 11. Known Risks / Remaining Questions

- **A2: Google cost increase.** More cache misses mean more paid `searchNearby` calls. It's bounded,
  but unmeasured. Within a 0.01° cell the returned *station set* is still the first searcher's
  circle (center ≤ ~0.5 mi away); distances are exact, but a station just at the 5-mile edge could
  be included or omitted.
- **A2: sort stability.** Distances are rounded to 0.1 mi before sorting, as the miss path already
  did, so stations tied after rounding may swap order between a hit and a miss. This is cosmetic.
- **A3 and the A5 component check are source-text assertions**, not behavioral tests.
  - A3 has no behavior to test: it's prompt text.
  - A5's classifier is unit-tested, but that the component *renders* each state is asserted only by
    source inspection, because the repo has no component-test environment.
- **A4: remaining cost exposure.** Suggested chips are still unlimited for guests and free users
  (pre-existing; no rate limit on the route).
- **Policy question for Don, not changed here.** `CLAUDE.md`: "An active rental must remain fully
  usable if Pro lapses mid-rental." The fuel math does stay usable, but "Find Gas Near Return" is
  Pro-gated (via the same `/gas/nearby` gate as Find Gas, which reads the **JWT** plan, not the DB).
  A lapsed trial loses station prices at the moment they matter most. Whether that violates the rule
  is a product decision.
- **Process notes:**
  - My first A2 regression test used coordinates (40.02 vs 40.06) that round into *different*
    0.1° cells, so it passed on the old code and proved nothing. That was caught by running it
    fail-first; the coordinates were fixed (40.01 vs 40.04, same old cell), and it then failed on
    the old code as intended.
  - I also briefly used `git stash` to set up a merge test, which was unnecessary. It was popped
    immediately with no changes lost, and the merge test was redone in a throwaway worktree.

## 12. Claude's Assessment

**READY FOR REVIEW.** Each fix is minimal, covered by fail-first tests, passes all required checks,
and merges cleanly with #54. A4 only tightens a gate. The open items (AI rate limiting, the rental
station-search policy) are flagged rather than silently expanded into scope before a demo.

## 13. Questions for ChatGPT

1. **A2:** is 0.01° the right cache granularity, given Google `searchNearby` cost vs. correctness?
   Would you instead key on 0.01° but filter out stations beyond the 5-mile radius of the *current*
   request on a hit?
2. **A4:** is exact-text matching against the translated chip lists sufficient, or should the client
   send a chip **index** (0–5) that the server maps to text? Does either approach open a gap we've
   missed (e.g. Unicode normalization of the ES `¿` strings)?
3. **A4:** should rate limiting on `/api/ai/chat` for guests and free users be treated as P1 now
   that the flag bypass is closed? The `RateLimitCounter` model already exists in the schema.
4. **A5:** does classifying `error` before `stations` risk hiding stations in a response that
   carries both `error` and a non-empty `stations`? No current route returns that shape, but is it
   the right precedence?
5. **Policy:** does Pro-gating "Find Gas Near Return" for a rental that started while Pro, after Pro
   lapses, conflict with the "active rental must remain fully usable" rule?

## 14. Requested Review Scope

Highest scrutiny:
1. **A4:** `app/api/ai/chat/route.ts`, the `ALLOWED_SUGGESTED` construction and the gate. This is
   the only security-relevant change: confirm there's no bypass left and no legitimate user
   (EN/ES, guest/free/Pro) is newly blocked.
2. **A2:** `lib/nearbyGas.ts` `cacheKey` / `withDistancesFrom`: correctness of cache-hit results
   and the cost tradeoff.
3. **A5:** `lib/nearbyResponse.ts` precedence and `FindGasNearReturn.tsx` state handling.

Lower priority: the A3 copy change, translations, and test-comment edits.
