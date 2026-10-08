# Phase 1 — Activation Plan

**Status: PLANNED** (2026-10-08). Nothing in this document is implemented. No code,
migration, or production change accompanies it.
**Stage: READY FOR OWNER REVIEW — PHASE 1 PLAN.**
**Risk class:** the plan itself is docs-only. Parts of the implementation it
proposes are HIGH (schema, notifications, entitlement-adjacent copy) and are
marked as such in section 11.

Sources: read-only production aggregates (2026-10-08, test/admin accounts
excluded, counts only, no identifiers), a read-only code audit of `main`
(`bd0916f`), and the Phase 0.5 baseline in
`docs/reviews/2026-10-07-gascap-daily-phase05.md`. Claims not opened in code
are marked *(unverified)*.

---

## 1. Funnel diagnosis

**GasCap has an activation problem before it has a gamification problem.**

| Step | Users | % of signups | Note |
|---|---:|---:|---|
| Signed up | 350 | 100% | 30-day Pro trial granted to every new signup |
| Added a vehicle | 123 | 35.1% | |
| Completed a calculation (`calcCount ≥ 1`) | 118 | 33.7% | |
| Saved a station | 1 | 0.3% | Find Gas is effectively unused as a habit |
| **Logged a first fill-up** | **15** | **4.3%** | 12.2% of vehicle owners |
| Logged a second fill-up | 7 | 2.0% | **47% of first-fillers go on to log a second** |
| Currently paid | 2 | 0.6% | 1/127 historical trials |

Findings that shape the plan:

1. **The leak is vehicle → first fill-up, not repeat behaviour.** 109 of 123
   vehicle owners never logged a fill-up; 68 of them also calculated. Once
   someone logs one fill-up, nearly half log another (median gap 3.0 days, n=7,
   range 0–11.9). Fixing the first fill-up is the highest-leverage move.
2. **Time to first fill-up is long.** Of 15: 3 within a day, 2 within 7 days,
   7 in 7–30 days, 3 after 30 days. Only 5 of 350 (1.4%) log within a week.
3. **38 users calculated but never added a vehicle**, and the vehicle-add path is
   ~7 taps. 41 users have a vehicle and never calculated or logged.
4. **Nothing in the product asks for the fuel action at the right moment.** The
   one fill-up nudge fires once, at day ≥3, email + push, only for vehicle
   holders; its deep link (`/?log=1`) has no handler (verified: the only
   references are the senders). There is no second-fill trigger at all.
5. **The post-signup screen is crowded and measures nothing.** A blocking
   mode-selector modal, then up to five stacked cards above the calculator;
   the setup checklist is below the fold. None of these emits an event.
6. **Monetization is untestable now.** Every signup is Pro for 30 days, so the
   free caps (1 vehicle, 5 fill-ups/month, 3 stations) are not felt until
   day 30. Paywall measurement before activation is measuring the wrong thing.
7. **Acquisition is bursty and currently near zero.** Signups by month: Apr 43,
   May 166, Jun 10, Jul 3, Aug 118, Sep 10; **3 in the last 30 days, 0 in the
   last 7.** This constrains experiment design (section 6).
8. Retention baseline (Phase 0.5): D1 27.1%, D7 3.1%, D30 2.0%; DAU 1, WAU 7,
   MAU 25. Users who do come back mostly do not fuel.

Data caveats: `signupPlatform` is `unknown` for 219/350 (63%), so platform
splits are unreliable until server events carry the platform. Median ~12 days
to first fill-up (Phase 0.5) is dominated by a small n.

## 2. Objective

Raise the share of new users who perform a **real fueling action** and then
repeat it, and make GasCap's value visible at the moment of that action.
Priority order (owner-set): first meaningful fuel action → second → credible
fuel value → a return reason tied to actual fueling → lightweight engagement
only where it supports those → monetization testing later.

Non-goals: DAU growth, giveaway-entry volume, points, social features.

## 3. Activated User — exact definition

A user is **Activated** when **all** hold:

1. Not a test account, not role `admin`.
2. They have **≥ 2 valid fuel-action records** (`fillup_logged` server events,
   plus `rental_fill_logged`/`rental_final_fill_logged` and gig fill-ups, which
   are real fueling) whose **logged-at timestamps** are within **30 days of
   signup**.
3. The two records fall on **two distinct local calendar dates** (same-day
   duplicates exist in production: minimum gap is 0.0 days).
4. "Valid" = positive gallons and total cost, price within the existing
   plausibility bounds, and not removed by the user. Validity uses what the
   user logged, not a value GasCap supplied (see 8.6).

Timing uses `createdAt` of the record, not the user-entered fill date, so
back-dating a fill-up cannot manufacture activation. Back-dated entries remain
valid data; they just do not start the clock.

Leading indicators (not Activated): **Activation-1** = first valid fuel action
within 14 days. Baseline (all signups, no window): 4.3% first, 2.0% second.
A time-bounded baseline is computed by the first measurement script (11, P1-D).

## 4. Proposed journey

Principle: one obvious next fuel step at each stage, shown at the moment it is
useful, never a stack.

| Stage | Today | Proposed |
|---|---|---|
| Signup | OTP, 2 screens | Unchanged (no auth changes in Phase 1). Emit platform on server events |
| Mode selector | Blocking modal, no event | Add "Skip for now" + emit answer (treatment arm; see 6) |
| Home, no vehicle | 3–5 banners, checklist below fold | Treatment: **one** "Next fuel step" card (add your car → log a fill-up) replaces FreshSignup/Welcome/FirstCalcNudge stack |
| Add vehicle | ~7 taps | Unchanged in Phase 1 (VIN scan exists); measure step drop-off first |
| Price discovery | Calculator price field, Find Gas (Pro live prices) | Logger shows the area's EIA weekly average as a **placeholder only** (never a fillable value) |
| Log fill-up | Gallons + price start at 0; plan values prefilled from calculator | Fix dead-end CTA and `/?log=1`; address plan-as-actual (open question Q3) |
| After save | Calculator-path: comparison card. Manual path: form just closes | **Every** valid save shows a result card: vs same-grade weekly average, or an explicit "not enough data yet" with the reason, plus one next step |
| Return | Streak/visit nudges; no fuel trigger | One second-fill nudge, relevant to the user's own fueling (below) |
| Paywall | Day 21/28 emails; caps unfelt | Unchanged. Revisit only after activation moves |

**Second-fill nudge** (essential): if a user has exactly one valid fill-up and
no second by day 7 after it, send **one** push-or-email (push preferred if
subscribed; email respects `emailOptOut` at the send site). Content is factual
and conditional: if the user's area has ≥2 EIA observations since their fill-up,
state the change in the weekly average ("Regular in FL: +4¢ since the week of
Oct 6"); otherwise a plain reminder. No "buy now / wait" language.

## 5. Feature priority matrix

| Concept | Phase 1 call | Reasoning |
|---|---|---|
| Activation instrumentation (events, funnel panel) | **Essential** | Cannot manage what is not measured; 5 funnel steps emit nothing today |
| `/?log=1` deep link + "add vehicle first" CTA on the empty logger | **Essential** (defect fixes) | Existing nudge sends people to a page that ignores the request; the no-vehicle logger is a dead end |
| Post-save result card on every fill-up ("savings feedback") | **Essential** | Delivers credible fuel value at the exact moment of effort; uses Phase 0.5 baseline |
| Logger price **placeholder** from snapshots | **Essential** (small) | Cuts friction without inventing a reading; must not be a tappable fill (it would make savings ≈ 0 by construction) |
| Second-fill nudge | **Experiment** | Targets the only measured weakness after first fill; treatment arm only |
| Single "Next fuel step" onboarding card + skippable mode selector | **Experiment** | Hypothesis: fewer, clearer prompts raise first fill-up; reversible |
| "Prices below / near / above normal" line (favorability, reframed) | **Experiment** — inside the result card only | Needs enough history; must show "Not enough data yet" otherwise; no BUY/WAIT |
| Beat the Average | **Experiment** — same card, same data | It *is* the savings comparison, framed once; no separate surface |
| GasCap Daily / Today's GasCap home card | **Defer** | DailyFuelPulse already exists; a daily card builds visits, not fueling. Revisit once activation moves |
| GasPoints | **Defer** | No ledger exists; giveaway entries already reward early actions (+5 first calc, daily gift). Rules when built: separate from giveaway entries, no cash value or redemption, no points for passive/spoofable actions (views, check-ins, unverified station claims) |
| Challenges | **Defer** | Depends on points and on a habit that does not exist yet |
| Streaks | **Reject (new); keep existing** | Visit streak (`activeDays`/`streak`) already exists. A fueling streak is wrong for a weekly behaviour and would reward opening the app |
| Station verification | **Defer** | 1 saved-station user; verification is spoofable without a second signal |
| Shareable Wins | **Defer** | A planned-vs-actual share already exists; do not add surfaces before there are wins. Never share negative savings |
| Monetization / paywall changes | **Defer** | Caps unfelt during trial; no signal until activation grows |

## 6. Experiment design

**Name:** `activation_v1`. **Hypothesis:** a single clear next-step card, a
result card after every save, and one second-fill nudge raise the share of new
users who log a first valid fill-up within 14 days and a second within 30.

**Honest constraint — sample size.** With a baseline near 4% and a target of
~10%, 80% power at α=0.05 needs ≈ 280 new users per arm (~560 total). At 3
signups/30 days that is unreachable; at the August rate (118/month) it is
~5 months. Therefore:

- Build and ship the **non-experimental fixes (P1-A/B)** to everyone now; they
  are defects and measurement, not hypotheses.
- Run the randomized test only when acquisition resumes (**go criterion:
  ≥ 100 eligible signups in a rolling 30 days**). Until then the experiment is
  built, QA'd on the allowlist, and held at 0%.
- If the owner chooses to run at low volume anyway, results are labelled
  **directional only** and no ship decision rests on them.

**Design**

- **Unit / eligibility:** new signups created after the flag's start timestamp;
  `isTestAccount=false`, `role='user'`; all platforms (native loads the live web
  app; stratify the readout by platform). Existing users are never assigned.
- **Assignment:** deterministic hash of `userId + 'activation_v1'`, 50/50
  control/treatment once past QA, computed **server-side at signup** and
  persisted (stable if rollout % changes). Never derived from the JWT.
- **Control:** today's experience, including the existing day-3 first-fill-up
  nudge. **Treatment:** the section 4 items marked Experiment. The
  non-experimental fixes are in both arms.
- **Primary metric:** share of assigned users with a **first valid fuel action
  within 14 days**. **Key secondary (north star):** Activated rate (section 3).
  Not DAU, not visits, not points.
- **Guardrails** (any breach pauses treatment): D7 return not worse; email
  opt-out/unsubscribe and push opt-out rate not higher; calculator completion
  not lower; share of fill-ups with outlier/invalid values not higher; same-day
  duplicate fill-up rate not higher (gaming check); purchase conversion and
  trial-to-paid not worse; no increase in support contacts or crashes.
- **Observation window:** 30 days per user; first look at the 14-day mark,
  decision at 30 days after the last assigned user reaches day 30. No peeking
  decisions before minimum volume.
- **Contamination to hold constant:** trial-drip emails, streak/giveaway
  prompts, the $9.99 new-member banner (first 7 days) apply equally to both arms.
  The manual trial-conversion cron must not be run mid-test.
- **Analysis:** intent-to-treat on assignment; report counts and exact CIs;
  never report a percentage lift without n.

## 7. Analytics and events

Existing server events already cover: `signup_completed`, `trial_started`,
`vehicle_saved`, `fillup_logged`, rental fill events, `trial_expired`,
`checkout_started`, `purchase_completed`. Existing client events:
`calculator_completed`, `paywall_viewed`, `upgrade_plan_selected`.

| Funnel name | Source | New? |
|---|---|---|
| Signup | `signup_completed` | exists; add platform for password/Google paths |
| Vehicle Added | `vehicle_saved` | exists |
| First Fuel Intent | first `calculator_completed` **or** first price lookup/Find Gas price view | client event new for price lookup |
| First Meaningful Fuel Action | first valid `fillup_logged` / rental fill / gig fill | exists (derive) |
| First Fill-Up | first personal `fillup_logged` | exists (derive) |
| Savings Feedback Seen | `fillup_feedback_viewed` {outcome: `priced`\|`insufficient_data`\|`excluded`, reason} | **new, client (advisory)** |
| Second Meaningful Fuel Action / Second Fill-Up | derive from `fillup_logged` on a distinct local date | derive |
| Activated User | derived by the funnel panel/query per section 3 | derive |

Additional new events (all additive, allowlisted in
`app/api/analytics/event/route.ts` with strict metadata schemas):
`experiment_assigned` (server, idempotent, {key, variant}), `next_step_card_viewed`
and `next_step_card_clicked` (client, {step}), `mode_selected`/`mode_skipped`
(client), `fill_cap_hit` (server, at the existing 403), `fillup_nudge_sent`
(server, {kind, channel}), `fillup_nudge_clicked` (client landing on `/?log=1`).

Rules: server events are authoritative; client events are advisory and shown as
such (existing panel convention). No gallons, price, location, or station in
event payloads. `idempotencyKey` on every server event. The engagement-baseline
panel gains the funnel and Activated-User views (read-only).

## 8. Architecture changes

All additive and reversible. FuelPriceSnapshot is **not** modified.

1. **Assignment store.** New table `ExperimentAssignment(userId, key, variant,
   assignedAt)`, unique on `(userId, key)`, created with direct additive SQL
   (`scripts/add-experiment-assignment.mjs`, idempotent, never `db push`).
   *Zero-schema alternative:* persist the assignment as the idempotent
   `experiment_assigned` AnalyticsEvent and read it back. Recommendation: the
   table (cheap lookups, clean joins). **Owner/ChatGPT decision.**
2. **`lib/experiments.ts`:** `assignOnSignup(userId)` (pure hash + insert,
   idempotent), `getVariant(userId, key)` (DB read, not JWT), kill switch via
   env `ACTIVATION_EXPERIMENT_ENABLED` and `ACTIVATION_EXPERIMENT_PCT`. Called
   from the three signup paths (OTP, Google, legacy register) after the trial
   grant, in try/catch so assignment can never fail a signup.
3. **`GET /api/experiments/activation`:** authenticated; returns the caller's
   variant only. Clients cache for the session.
4. **`lib/fuelFeedback.ts`:** pure function from a saved fill-up + snapshot
   data to a result-card model. Reuses `lib/savingsBaseline.ts`; adds a
   history-sufficiency rule (e.g. ≥ 8 weekly observations in the chain before
   any "normal" wording; else "Not enough data yet"). All fuel math stays out
   of components.
5. **Client surfaces:** `NextFuelStepCard` (replaces the banner stack for
   treatment), result card in `FillupLogger`/`ManualFillupLogger`, placeholder
   price, empty-logger vehicle CTA, `/?log=1` handler that opens the logger.
6. **Never invent a reading.** The price placeholder is display-only; the
   field stays empty until the user types. The result card never computes a
   savings number from a value GasCap supplied.
7. **Nudge cron:** `app/api/cron/fillup-second-nudge`, added to
   `.github/workflows/crons.yml` (quote UTC and ET), outside 9:45–10:15 AM ET,
   `npm run check:crons` must pass, `emailOptOut` filtered **at the send site**
   (not in account-state queries), at most one send per user, treatment arm only.
8. **Service worker:** new routes are `/api/*` and NetworkOnly by default
   (`npm run check:sw`); no cache changes.
9. **Docs/copy:** update `app/help/page.tsx`, the `APP FEATURES` block in
   `app/api/ai/chat/route.ts`, and EN+ES in `lib/translations.ts`; no 🔥 emoji.

Security/privacy: assignment is server-side and not user-settable; analytics
payloads carry no PII, location or fuel values; the area used for history is
the coarse EIA area already stored; no new location prompt; nudges respect
opt-out; test/admin excluded from assignment and metrics.

## 9. Rollout and rollback

1. **0%:** code merged dark. Admin/test allowlist forced to treatment for QA.
2. **Allowlist QA:** walk the treatment journey on web and iOS/Android shells.
3. **Hold** until the section 6 go criterion is met (≥ 100 eligible signups
   per rolling 30 days) or the owner explicitly accepts a directional run.
4. **50/50** for eligible new signups. Guardrails reviewed weekly.
5. **Rollback:** set `ACTIVATION_EXPERIMENT_ENABLED=false`; all users get the
   control experience immediately (the table and events stay inert). Reverting
   P1-A/B fixes is a normal code revert. The new table is deliberately **not**
   dropped (no destructive production DDL). No existing data is changed.

Native: web-only changes reach the shells with no Codemagic rebuild.

## 10. Explicit exclusions

No GasPoints, challenges, new streaks, station verification, shareable wins,
Today's GasCap card, BUY/WAIT or any price prediction, paywall/price/product-ID
changes, auth changes, Rental Return Assistant changes, sweepstakes/AMOE
changes, new persistent JSON stores, `FuelPriceSnapshot` schema changes,
rewards for passive or unverifiable actions, or fabricated historical data.
Re-nudging the ~109 existing vehicle-owners-without-fill-ups is also excluded:
they were already sent the one-time nudge, and re-contacting them is a
separate owner decision.

## 11. Recommended implementation sequence

Each step ends at READY FOR REVIEW; none merges without owner authority.

| Step | Scope | Risk | Review |
|---|---|---|---|
| **P1-A** | Instrumentation (new events + platform on server events + funnel/Activated views in the admin panel); fix `/?log=1`; empty-logger "add vehicle" CTA | LOW–MED | One PR review |
| **P1-B** | `lib/fuelFeedback.ts` + post-save result card on both log paths + price placeholder + help/AI/ES copy; regression tests (incl. "unknown renders as unknown", no fabricated reading) | MED | PR review; ChatGPT review recommended (fuel/savings claims) |
| **P1-C** | `ExperimentAssignment` migration (additive SQL), `lib/experiments.ts`, signup hooks, flag, `NextFuelStepCard`, skippable mode selector, second-fill nudge cron | **HIGH** (schema + notifications) | Full gates + ChatGPT packet, migration-before-deploy |
| **P1-D** | Time-bounded baseline query for Activation-1 / Activated; readout script | LOW | PR review |
| **P1-E** | Start at allowlist, then 50/50 when go criterion is met; weekly guardrail review | — | Owner decision |

P1-A and P1-B are valuable without any experiment and can ship first.

### Open questions for the owner

- **Q1.** Accept the volume gate (≥ 100 eligible signups / 30 days) before
  randomizing, or run low-volume as directional only?
- **Q2.** Assignment table (recommended) or zero-schema AnalyticsEvent?
- **Q3.** Calculator → "Log this fill-up" prefills the *plan* (gallons, price)
  as if actual; a user who taps Save records the plan. Options: leave as is,
  require confirming "what did you pump?", or label such records "from plan"
  and exclude them from savings. Recommended: require confirmation. This
  touches fuel-record integrity and savings claims.
- **Q4.** Is it acceptable for the mode selector to become skippable (it is
  currently blocking and unmeasured)?
- **Q5.** Should rental/gig fill-ups count toward Activated (proposed: yes,
  they are real fueling)?

### Defects noted during the audit (not fixed here)

`/?log=1` has no handler; manual logger dead-ends with no vehicle; setup
checklist sits below the fold; `/signup` fires signup pixels for returning
users (it cannot tell new from returning); free fill-up cap is invisible until
a failed save; `fillup_logged` and `vehicle_saved` write `originPlatform:
'unknown'`; `rental_near_return_viewed` / `rental_prepare_return_cta_used` may
be missing from the client allowlist *(unverified)*; `locked_feature_shown`
exists only as a gtag call, not an `AnalyticsEvent`; the manual
trial-conversion cron is not scheduled.
