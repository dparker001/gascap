# ChatGPT Review Packet — Phase 1 P1-B (plan-vs-actual integrity + post-save fuel feedback)

**Status: READY FOR INDEPENDENT REVIEW — P1-B.** Not merged, not deployed. Base `70aba87` (main).
Authority: owner authorization for P1-B only (docs/PHASE1_ACTIVATION_PLAN.md, decisions Q3/Q5; P1-A merged).

## 1. Objective
(a) Fuel-data integrity (owner decision Q3): a calculator plan must never silently become the actual
pumped values. (b) Give every saved fill-up a credible result card: a comparison with the same-grade
EIA weekly average, or an explicit "not enough data yet" with the reason. (c) Show the weekly average
as a display-only hint beside the price field.

## 2. Repository State
Branch `feat/phase1-activation-p1b` from `origin/main` `70aba87`. No schema, migration, experiment,
P1-C, notification, savings-logic or `FuelPriceSnapshot` change. Build-regenerated `public/sw.js` /
`workbox-*.js` were restored, not committed.

## 3. What I Found
- `FillupLogger` initialised gallons and price from `prefill` (`String(prefill.gallonsPumped)`), so a calculator
  plan (or a Find Gas posted price) was saved as the actual fill-up if the user just tapped Save. The existing
  comparison card then compared the plan with itself.
- The manual / Find Gas path closed the logger immediately after save with no feedback. Only calculator-originated
  saves saw a (planned-vs-actual) card, and no card ever reported price vs the weekly average after save.
- POST /api/fillups already returns the saved row including the baseline frozen at save time (Phase 0.5), so no
  server change is needed.

## 4. What I Changed
1. **Plan vs actual (Q3):** `components/FillupLogger.tsx` — gallons/price fields start empty. The plan (or posted price)
   is shown as reference ("From your plan: X gal at $Y/gal") with an explicit **Same as planned** button (or **Use posted
   price** when only a price exists). Only that tap, typing, or a receipt scan fills the fields; blank Save is refused by the
   existing validation. The POST body is built from the fields only.
2. **`lib/fuelFeedback.ts` (pure):** builds the card model from the SAVED row using `computeFillupSavings(saved, {})` —
   stored baseline only, same-grade rules, sanity checks, paying more reported plainly, no fallback, no prediction.
   Reasons: no_grade / unsupported_grade (e85) / no_baseline / invalid.
3. **`components/FuelFeedbackCard.tsx`:** renders it (EN + ES), with one next step (add odometer / log next with odometer) and
   an EIA-source footnote. Shown on both save paths: inside the planned-vs-actual card, and as a new "Fill-up saved" card for
   the manual / Find Gas path (Done calls `onSaved`).
4. **Price hint:** once a priceable grade is chosen, a caption shows the grade-matched EIA average and its week. It is never
   written into the field.
5. **Event:** `fillup_feedback_viewed` {outcome: priced|insufficient_data, reason?} — client allowlist, authenticated-only,
   strict enums, fired once per card mount. No gallons/price/station/grade/date.
6. Help page + AI chat APP FEATURES + EN/ES translations updated.

## 5. Architectural Decisions
- Feedback uses only the baseline frozen at save time, so what the user sees matches what History/Savings later show.
- Hint is national and grade-matched (existing `/api/gas-price/national?grade=`); no new API. Regional/state hints would need
  an API change and were left out.
- Excluded on purpose (classified Experiment in the plan): the "below/near/above normal" line, "Beat the Average" framing,
  Next Fuel Step card, second-fill nudge.

## 6. Security Impact
None to auth/authorization. One new authenticated-only client event with strict enums, same trust class as existing advisory events.

## 7. Data / Database Impact
None. No schema or migration. The only change to what is stored is behavioural: actual values must now be entered or confirmed,
so plan values are no longer saved by default.

## 8. User / Business Impact
Slightly more friction on the calculator-to-log path by design (one tap on "Same as planned" if the plan was right). In exchange,
saved fuel data and savings are real, and every save ends with a result or an honest "not enough data". No pricing/plan/limit change.

## 9. Testing Performed
- New `p1bFuelFeedback.test.ts`: 52 tests (model, plan-never-saved-as-actual, hint display-only, both save paths, EN/ES parity,
  analytics ingest).
- Full `npm test`: 170 files, 2898 passed, 5 skipped (main after P1-A/fleet: 169 files, 2846 passed, 5 skipped). No existing test was changed.
- `tsc --noEmit` clean; `npm run build` passes; `check:crons` 22/20/2; `check:sw` 266/266.
- Fail-before: with only `FillupLogger.tsx` reverted to `main`, 7 of the new assertions fail (empty-field init, reference + Same-as-planned,
  explicit-only copy, caption-not-field, feedback from saved response, manual-path card, comparison-card feedback).

## 10. Files Changed
`components/FillupLogger.tsx`, `components/FuelFeedbackCard.tsx` (new), `lib/fuelFeedback.ts` (new), `lib/translations.ts`,
`app/api/analytics/event/route.ts`, `app/help/page.tsx`, `app/api/ai/chat/route.ts`, `__tests__/p1bFuelFeedback.test.ts` (new), this packet.

## 11. Known Risks / Remaining Questions
1. **No jsdom:** component behaviour is asserted from source plus pure-model tests, not rendered. Needs a runtime pass on the
   production QA account after deploy (calculator -> Log this fill-up -> blank Save refused; Same as planned; manual save card).
2. **A fill-up saved with no grade or with E85** gets "not enough data" by design, which will be common (33 of 37 historical rows have a grade).
3. **Hint is national only** and appears only after a grade is chosen.
4. **Existing planned-vs-actual card** still compares plan vs actual gallons; with Same as planned it will show a zero difference. Left as is.
5. The result card appears after save for Free users too (the monthly cap check still happens before save and is unchanged).
6. A very fast "Same as planned" tap now makes plan-confirmed values indistinguishable from typed values in the data. This is intentional (explicit confirmation); no flag is stored (no schema).

## 12. Claude's Assessment
In scope and revertable by a single revert. Biggest risk is the added tap on the calculator path; it is the owner-approved trade for data integrity.

## 13. Questions for ChatGPT
Is blank-fields-plus-explicit-confirm the right reading of Q3? Should "Same as planned" be recorded anywhere (would need schema)? Is "not enough data" copy for E85/no-grade acceptable?

## 14. Requested Review Scope
`FillupLogger` state/confirm flow and request body, `lib/fuelFeedback.ts` reuse of `computeFillupSavings`, card copy (EN/ES), the analytics allowlist/schema entry.
