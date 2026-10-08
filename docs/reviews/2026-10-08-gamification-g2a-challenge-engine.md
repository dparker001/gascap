# ChatGPT Review Packet — Gamification G2-A (Weekly Challenge Selection + Progress Engine)

**Status: READY FOR INDEPENDENT REVIEW — GAMIFICATION G2-A.** Not merged, not deployed. **No schema, no migration, no database work.**
Base `be7e9e83d557079ff27997bf2864b3281c1f7d2d` (main, G1 live). Independent of the deferred Phase 1 P1-C.

## 1. Objective
Define which three weekly challenges a user sees and how far along each is, from authoritative G1 state only — read-only. No
rewards, no UI, no new ledger rows (those are G2-B). G1 behaviour is untouched.

## 2. Repository State
Branch `feat/gamification-g2a-challenge-engine`. Three new source files + one test file + this packet. Nothing in `prisma/`, `scripts/`,
`lib/badges.ts`, `BadgeShelf`, `recordActivity`, `lib/gasPoints.ts`, the G1 routes or the customer Daily Fuel Check card changed.

## 3. Challenge catalog
| ID | Slot | Goal | Progress source | Proposed (G2-B) reward | Tracking |
|---|---|---|---|---|---|
| `fuel_check_3day` | 1 (always) | Daily Fuel Check on 3 distinct GasCap dates | `daily_fuel_check` ledger rows; complete when `weekly_3day_check` exists or progress reaches 3 | existing G1 `weekly_3day_check` +25 (no new award) | ledger_derived |
| `weekend_check` | 2 pool | Daily Fuel Check on a Sat/Sun of the week | `daily_fuel_check` rows whose `sourceRef` is Sat/Sun | `challenge_weekend_check` +10 | ledger_derived |
| `fuel_explorer` | 2 pool | Explore another supported grade | **none today** | `challenge_fuel_explorer` +15 | requires_g2b_hook |
| `pump_tracker` | 3 | One qualifying fuel action in the week | `fuel_action` ledger rows in the week | `challenge_pump_tracker` +25 | ledger_derived |
| `mpg_builder` | 3 (not offered in g2_v1) | A new qualifying fill-up yields a valid MPG | **none authoritative today** | `challenge_mpg_builder` +30 | requires_g2b_hook |
| `add_vehicle` | 3 (guidance) | Save a vehicle | n/a (guidance) | existing G1 `first_vehicle` +25 only | guidance |

Deferred/rejected (documented, not built): Early Week and Five-Day Check-In (a late-week arrival would see an already-impossible challenge),
Station Scout (farmable, artificial), Plan a Fill, Know Your Numbers, any grade-toggle reward from GETs.

## 4. Selection algorithm (`lib/gasChallengesRules.ts`, pure)
- `G2_CHALLENGE_VERSION = 'g2_v1'`. A rule change needs a new version and a Monday launch.
- `stableHash32(...parts)` = first 4 bytes of SHA-256 of the `|`-joined parts. No `Math.random`, no storage, no table.
- **Slot 1** always `fuel_check_3day`.
- **Slot 2** = `SLOT2_POOL[hash(userId, weekKey, version, 'slot2') % 2]` over `['weekend_check','fuel_explorer']` — a pure function of user/week/version, so
  it is identical on every device all week and independent of user state. New Monday or new version re-rolls it.
- **Slot 3** is state-sensitive (owner-approved): no vehicle and no completed Pump Tracker -> `add_vehicle`; otherwise `pump_tracker`; if MPG Builder were
  both `MPG_BUILDER_SELECTABLE` and the user had odometer history it would hash-choose between `pump_tracker` and `mpg_builder`. Once Pump Tracker is complete it
  stays slot 3 even if the vehicle is later removed, so a completed challenge never disappears. No persistence freezes slot 3.
- Slot 1 and 2 never need a fuel purchase; slot 3 needs none for users without a vehicle.

## 5. Progress model and API
`ChallengeView` per slot: `slot, id, titleKey, status (available|complete|guidance|tracking_unavailable), progress (number|null), target, proposedReward,
rewardAction, rewardIsExistingG1, trackingCapability (ledger_derived|guidance|requires_g2b_hook), weekKey`. `titleKey` is a copy identity for G2-B; no copy ships in G2-A.

`GET /api/gaspoints/challenges` -> `{ eligible, weekKey, version, challenges[3] }`. Session identity only; the handler takes no request (so no client parameters); no writes of any
kind; admin -> `{ eligible: false, challenges: [] }` (same rule as G1 `getEligibility`). I did not include the G1 balance/level (the card already fetches it; including it would duplicate queries).
Reads: one ledger `findMany` (this week's `daily_fuel_check` + `fuel_action` rows by `sourceRef` in the week's 7 date keys), one `findUnique` on the weekly key, one `vehicle.count`.

## 6. Fuel Explorer boundary
G1 has no authoritative write representing "explored another grade"; grade viewing is a read-only GET and the daily row stores only the date. The engine therefore reports
`tracking_unavailable` / `progress: null` / `requires_g2b_hook` and never infers completion. **G2-B hook design for review (not implemented):** a new authenticated
`POST /api/gaspoints/explore { grade }` that completes the challenge when the grade differs from the server-derived default pulse grade (`defaultPulseGrade`) and a Daily Check exists
this week — authoritative without new storage; award once per week. Listed in `PLANNED_G2B_HOOKS`.

## 7. MPG Builder tracking decision
Audit result: **not authoritatively derivable read-only.** `computeMpg` recomputes MPG live from all of a user's fill-ups ordered by the user-entered `date`; fill-ups can be back-dated,
edited via PATCH or deleted, so "a *newly created* fill-up produced a valid MPG" is not recoverable and a displayed completion could flip or be created after the fact. Decision:
`requires_g2b_hook`; `MPG_BUILDER_SELECTABLE = false`, so the selector never offers it; the catalog still understands it. G2-B hook: evaluate at `POST /api/fillups` after persist, at CREATE time only, never on PATCH.

## 8. Future action + idempotency design (not awardable now)
Planned explicit actions: `challenge_weekend_check`, `challenge_fuel_explorer`, `challenge_pump_tracker`, `challenge_mpg_builder`; `weekly_3day_check` unchanged. Key:
`challenge:<challengeId>:<userId>:<weekKey>` with `sourceRef = weekKey`. Compatibility with the global unique `idempotencyKey` column: every G1 key begins with its own action name and none with
`challenge:`, so no collision is possible; the format is a TEXT value well under 200 chars; the `action` column is TEXT (no enum), so no migration is needed. The planned actions are **not** in
`GASPOINT_RULES`, so `isGasPointAction()` rejects them — a test pins that no ledger row can be written with them in G2-A.

## 9. Economics (documentation only; nothing changes)
Levels stay 0/100/250/500/1000. Projected weekly earning (G1 + proposed G2-B): low 5–15, moderate about 50, strong about 155 (35 checks + 25 mission + 20 five-day-equivalent/10 weekend + 25 pump + 50 fuel_action).
With the one-time 70 (welcome + vehicle + station): moderate reaches Road Ready in week 1, Elite in about week 19; strong reaches Elite in about week 7; low takes years.
**Fuel-action velocity:** G1's +50/day fuel action is uncapped per week, so a gig driver fuelling daily could earn up to 350/week and reach Elite in about 3 weeks. G2-A changes none of it. Review real production
velocity after 4–6 weeks (and consider a level above 1000) before any monetary/redemption value is ever attached to GasPoints.

## 10. Security / abuse
Read-only; session user only; no client-supplied selection, completion, points, challenge ids or keys. Progress from the append-only ledger cannot be revoked or doubled by deleting/re-creating records.

## 11. Testing
`g2aChallengeEngine.test.ts` — 44 tests: deterministic selection (stability, week/version namespaces, even split, no randomness/storage), slot 1 (always present, distinct-date progress, existing reward reused),
Weekend Check (Sat/Sun), Fuel Explorer boundary, slot 3 transitions and stability, MPG Builder decision, authoritative reads for the current week only (canonical-calendar boundaries, Sunday night vs Eastern Monday midnight),
admin/test eligibility, cross-user isolation, API (401, session-only, no params, no writes), G1 rules/levels unchanged, planned actions not awardable, no badge/streak/giveaway/analytics touch, no schema or challenge table,
untouched customer card and daily-check route, calendar reuse, idempotency-key compatibility. Full suite 173 files, 3018 passed, 5 skipped; `tsc`, `build`, `check:crons` (22/20/2), `check:sw` (270/270) pass.
Fail-before: the engine and route do not exist on `main`, so the suite cannot run there.

## 12. Files Changed
New: `lib/gasChallengesRules.ts`, `lib/gasChallenges.ts`, `app/api/gaspoints/challenges/route.ts`, `__tests__/g2aChallengeEngine.test.ts`, this packet. No existing file modified.
No help-page/AI-block/translation change: G2-A ships no customer-facing behaviour.

## 13. Known Risks / Remaining Questions
1. `fuel_explorer` can be selected for ~half of users in slot 2 yet reports `tracking_unavailable` until G2-B; it is invisible to customers in G2-A. Should G2-B require its hook before the pool offers it (i.e. ship G2-B with the hook, or drop it from the pool until then)?
2. Slot 3 changes with real state (approved); a completed Pump Tracker is kept stable.
3. The weekend challenge can start Monday for everyone and is never impossible within its week (Sunday check still counts).
4. `weekend_check` and `fuel_check_3day` read the same rows; completing them together is expected.
5. MPG Builder stays unavailable until a create-time hook exists (G2-B).
6. Selection quality: 2-item pool means week-to-week repeats are common for a given user; widening the pool needs a new version.

## 14. Requested Review Scope
Selection determinism and versioning, slot-3 stability rule, ledger-derived progress queries, the Fuel Explorer and MPG Builder tracking boundaries, key/action compatibility, and the read-only/session-only API.
