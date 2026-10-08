# ChatGPT Review Packet — Gamification G2-B (Weekly Challenges UI + Server-Authoritative Rewards)

**Status: READY FOR INDEPENDENT REVIEW — GAMIFICATION G2-B.** Not merged, not deployed. **No schema, no migration, no database work.**
Base `1f53bc5165482031d0ec03538bd32d6c9f024fff` (main; G1 + G2-A live). Independent of the deferred Phase 1 P1-C.
Risk class: HIGH-adjacent (new reward paths wired into three fuel-logging flows and the Daily Check).

## 1. Objective
Make the weekly challenges real for customers: a compact "This Week" section in the Daily Fuel Check card and server-authoritative rewards for
Weekend Check, Fuel Explorer and Pump Tracker — with no partial first week, no client-chosen anything, and G1 untouched.

## 2. Launch boundary (no partial first week)
`G2_REWARDS_START_WEEK = '2026-10-12'` (`lib/gasChallengesRules.ts`), compared with the canonical GasCap week key (`lib/gasCapCalendar.ts`, America/New_York,
Mon–Sun) via `isG2Active(weekKey)`. Never browser time, never the deploy date.
- Every award helper returns before touching anything unless the current GasCap week is active, so **no G2 reward row can be written before 2026-10-12** (tested).
- `GET /api/gaspoints/challenges` returns `{ g2Active: false, startsOn, challenges: [] }` before then, so no customer is shown a challenge that cannot pay.
- The card shows only a compact "Weekly Challenges start Monday, Oct 12" notice plus the **unchanged G1 weekly-mission presentation** until the launch week; once active the
  "This Week" list replaces that presentation (it would duplicate challenge #1). G1 Daily Fuel Check behaviour is identical before and after.

## 3. Actions, values, idempotency
`GASPOINT_RULES` gains exactly four actions: `challenge_weekend_check` +10, `challenge_fuel_explorer` +15, `challenge_pump_tracker` +25, `challenge_mpg_builder` +30 (rule only).
The six G1 values and the level thresholds are unchanged. Identity: `challenge:<challengeId>:<userId>:<weekKey>` (unique via the existing ledger key), `sourceRef = weekKey`.
Reward amounts in the challenge catalog now read from the rule table (single source of truth). `weekly_3day_check` remains challenge #1 and is not duplicated.

## 4. Award only SELECTED challenges (`lib/gasChallengeAwards.ts`)
Each helper derives, on the server: active week -> eligibility (admins never earn) -> the user's authoritative weekly selection (same selector and state loader as the read model) ->
the underlying business action already persisted -> unique-key insert. A challenge not in the user's set is never rewarded (a Fuel Explorer user gets no Weekend reward, etc.).
- **Weekend Check (+10):** in `POST /api/gaspoints/daily-check`, after the G1 check persisted; requires slot 2 = `weekend_check`, today is a GasCap Sat/Sun, and today's daily row exists.
  Evaluated on every call (idempotent), so a retry after a transient failure can still award. The G1 +5 is untouched; the response `awards` lists the challenge award as its own item and `status` is refreshed.
- **Fuel Explorer (+15):** new `POST /api/gaspoints/explore { grade }`. Body may contain only `grade` (userId/points/action/challengeId/idempotencyKey/completed -> 400). Awards only if: active week; slot 2 = `fuel_explorer`;
  a Daily Check exists this week; grade supported; grade != the **server-derived** default pulse grade (`defaultPulseGrade`: latest priceable grade from the last fill-up, else Regular — the client never reports it); not already awarded.
  Repeated posts/grade switching award nothing more. Outcomes (`awarded`, `already_complete`, `not_selected`, `no_daily_check`, `same_grade`, `invalid_grade`, `not_active`, `ineligible`) are returned for the client; no PII.
- **Pump Tracker (+25):** `awardChallengesAfterFuelAction`, called AFTER the existing G1 `awardFuelActionIfQualifying` in the personal fill-up route, the gig route and `createRentalFillup`. Requires slot 3 = `pump_tracker`,
  a qualifying record (EV/kWh and invalid never qualify) and the persisted G1 `fuel_action` row for today. Selection is evaluated from the user's state at that moment (see risk 1).
- **MPG Builder:** `MPG_BUILDER_SELECTABLE` stays `false`; the rule exists for readiness but `AWARDABLE_CHALLENGES` excludes it and no code path awards it (test + code scan). I deliberately did not build its create-time hook (scope/risk): left for a later G2-B2/G2-C review.
- **Failure semantics:** every entry point swallows and logs its own errors. A challenge failure can never fail or roll back the daily check or the fill-up, and cannot alter the P1-B fuel result.
- **No circular imports:** `gasChallengeAwards -> gasChallenges / gasPoints / gasChallengesRules`; none of those import it.

## 5. Read model (`GET /api/gaspoints/challenges`) after rewards
Adds `g2Active` and `startsOn`. For the three reward-bearing challenges the **award row is the authoritative completion**: Fuel Explorer is `available 0/1` then `complete 1/1`
(`trackingCapability: server_authoritative`), never `tracking_unavailable`. Pump Tracker completes only via its own award row (a fuel action logged before Pump Tracker was selected does not count).
Weekend Check also shows complete when a Sat/Sun daily row exists, so a failed best-effort award is never shown as "not done". MPG Builder remains `tracking_unavailable` and is never selected. Still read-only.

## 6. "This Week" UI and copy
Compact section inside `GasCapDailyCard`, exactly three rows (name, purpose, progress, reward, completion). Fuel Explorer rows prompt "Tap a different fuel grade…"; the chip switch fires the explore POST **only** when Fuel Explorer is the selected,
open challenge and the grade differs from the default — ordinary grade changes stay read-only GETs. Guidance row: "+25 GasPoints already available through GasCap" and no reward line of its own. Completion shows
"Weekly Challenge Complete!" and each award on its own line (e.g. +50 Fill-Up Logged, then +25 Pump Tracker — never a merged +75). EN + ES (parity test), no pressure/countdown/casino language (scan), animation disabled under reduced motion.
The card re-reads on `fillup-saved` / `vehicle-saved`. Help page + AI features block updated (with the launch date).

## 7. Response-shape compatibility
`POST /api/fillups` and the gig POST keep the existing single `gasPointsAwarded` (unchanged) and add `gasPointsAwards: AwardSummary[]` (G1 fuel action first, then challenge awards). The only caller (`FillupLogger`) reads both: the G1 +50 line is unchanged and challenge awards render as a separate breakdown. The daily-check response already returned an `awards` array; the Weekend award is appended to it.

## 8. Admin reporting (minimal)
`gasPoints.g2`: this-week completions by challenge (3-day, weekend, explorer, pump), distinct users completing any, and total challenge points awarded; real users only (test accounts/admins excluded); read-only. "Users completing all reward-bearing selected challenges" needs per-user selection and is left for later.

## 9. Existing tests changed (flagged)
- `g1GasPoints` rules assertion: now "the six G1 values unchanged **and** exactly 10 rule entries" (G2-B legitimately ADDS four).
- `g2aChallengeEngine`: updated where G2-A's own behaviour was intentionally superseded (Fuel Explorer now authoritative; progress comes from award rows; pre-launch dates; the "untouched card/route" and "not awardable yet" assertions replaced by "G1 award modules untouched" and "MPG Builder has no award path").
All other G1/G2-A/P1 tests pass unchanged, including the G1 route, card and fuel-hook assertions (the G1 award lines in the routes were deliberately left intact and the challenge call added after them).

## 10. Testing
`g2bWeeklyChallenges.test.ts` — 64 tests (launch boundary, Weekend/Explorer/Pump rules, selected-only, concurrency, explore route contract, read model after rewards, UI/copy/EN-ES, admin report, separation). Full suite 174 files, 3082 passed, 5 skipped; `tsc`, `build`, `check:crons` (22/20/2), `check:sw` (270/270) pass.
Fail-before: with the four hook files reverted the hook-wiring tests fail; the new modules/routes do not exist on `main`.

## 11. Files Changed
New: `lib/gasChallengeAwards.ts`, `app/api/gaspoints/explore/route.ts`, `__tests__/g2bWeeklyChallenges.test.ts`, this packet.
Modified: `lib/gasPointsRules.ts`, `lib/gasChallengesRules.ts`, `lib/gasChallenges.ts`, `lib/gasPointsMetrics.ts`, `lib/translations.ts`, `lib/rentalFillups.ts`, `app/api/gaspoints/daily-check/route.ts`,
`app/api/fillups/route.ts`, `app/api/gig/fillups/route.ts`, `app/api/ai/chat/route.ts`, `app/help/page.tsx`, `components/GasCapDailyCard.tsx`, `components/FillupLogger.tsx`, `components/admin/EngagementBaselinePanel.tsx`, two test files. Nothing under `prisma/` or `scripts/`.

## 12. Known Risks / Remaining Questions
1. **Pump Tracker selection timing:** a user with no saved vehicle is on `add_vehicle`; a fill-up they log without a vehicle earns the G1 +50 but not Pump Tracker, and adding a vehicle later that week does not retroactively count that earlier fill-up. Rare (the manual logger requires a vehicle; the calculator path can log without one).
2. **Fuel Explorer UI path:** the chips are only visible after today's Daily Check; a user who checked earlier in the week but not today must check again to see them. The server requirement ("a check this week") is looser than the UI.
3. **Launch timing:** the code can be deployed before Oct 12 safely (inactive); after Oct 12 00:00 ET it activates with no further deploy. The first active week is the full week of Oct 12.
4. **Weekend award on retry:** evaluated on every daily-check POST, so a repeat call the same weekend day can award a missed challenge but never a duplicate.
5. **Rental awards have no inline reward UI** (unchanged from G1); the ledger still records them.
6. **MPG Builder** remains unavailable (non-selectable, no award path) pending a create-time hook design.
7. Admin report shows per-challenge counts only.

## 13. Questions for ChatGPT
Is evaluating selection from current state at award time (not a frozen weekly snapshot) acceptable for Pump Tracker? Should the explore POST also require today's check to match the UI? Is replacing the G1 weekly-mission presentation (rather than keeping both) in active weeks the right call?

## 14. Requested Review Scope
`lib/gasChallengeAwards.ts` (selection-gated awards, launch gate, failure isolation), the explore route contract, the three fuel-path hooks and the daily-check composition, the read model's award-row completion rules, the response-shape strategy, and the UI/copy.
