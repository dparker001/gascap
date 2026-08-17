# Draft: Modification / Suspension / Termination clause

**Status: DRAFT FOR ATTORNEY REVIEW. This is not legal advice.**
Prepared 2026-08-17 for Gas Capacity LLC. Nothing here should be published to
gascap.app/sweepstakes-rules until counsel has reviewed and revised it.

---

## Why this exists

The Official Rules currently commit to **"One (1) Grand Prize per Entry
Month."** The only circumstance in which no prize is awarded is narrow:

> "In the unlikely event that all entrants are ineligible under the frequency
> restrictions, no prize will be awarded for that Entry Month and the prize
> will not carry over."

That covers one specific cause. It does not cover an Entry Month in which a
drawing simply does not take place. No drawing occurred for **June 2026** or
**July 2026**, while the app continued to solicit and accrue entries.

Two things follow, and they should not be confused:

1. **A clause cannot fix the past.** Rules amendments operate prospectively.
   Adding this language does nothing for June or July, and it should not be
   presented — internally or externally — as though it does. Whether any
   remedy is owed for those months is a question for counsel.

2. **A discretionary clause was considered and is not recommended.** Language
   to the effect of *"drawings occur at Sponsor's discretion"* sits directly
   against a public offer of a "$50 Monthly Gas Card Giveaway" that collects
   entries on the strength of it. Soliciting participation while reserving an
   unqualified right not to award is the pattern that attracts scrutiny. The
   conventional protection is **cause-based**, and is drafted below.

The durable remedy is operational rather than textual: the drawing now runs
from a scheduled job that no-ops on every day but the last of the period, and
the daily integrity check reports a missing draw. `GIVEAWAY_PAUSED` — which
suppressed that alert rather than pausing anything — was cleared on
2026-08-17.

---

## Proposed clause

Suggested placement: new Section 11, after Winner Notification, renumbering
the sections that follow.

> **11. Modification, Suspension, and Termination**
>
> **(a) Causes.** If the Sweepstakes cannot be conducted as planned for any
> reason beyond the Sponsor's reasonable control — including infection by
> computer virus, bugs, tampering, unauthorized intervention, fraud, technical
> failure, failure of any third-party service on which the Sweepstakes
> depends, or any other cause that in the Sponsor's reasonable judgment
> corrupts or impairs the administration, security, fairness, integrity, or
> proper conduct of the Sweepstakes — the Sponsor reserves the right, in its
> reasonable discretion, to modify, suspend, or terminate the Sweepstakes or
> any Entry Month thereof.
>
> **(b) Award following termination.** If the Sweepstakes or an Entry Month is
> suspended or terminated under paragraph (a), the Sponsor will select the
> winner for that Entry Month in a random drawing from among all eligible
> entries properly received for that Entry Month prior to the time of
> suspension or termination. Entries received under both Method A and Method B
> shall be treated identically for this purpose.
>
> **(c) Delayed drawing.** If a drawing for an Entry Month does not occur on
> the scheduled date, the drawing will be conducted as soon as reasonably
> practicable thereafter from among all eligible entries properly received for
> that Entry Month. A delay in conducting a drawing does not cancel the
> drawing, does not forfeit any entry, and does not reduce the number of
> prizes to be awarded for that Entry Month.
>
> **(d) Notice.** The Sponsor will post notice of any modification,
> suspension, or termination at gascap.app/sweepstakes-rules and will notify
> affected entrants by email at the address associated with their entry.
>
> **(e) Reservation.** The Sponsor reserves the right to disqualify any
> individual it finds to be tampering with the entry process or the operation
> of the Sweepstakes, or acting in violation of these Official Rules.

---

## Notes for counsel

- **(c) is the paragraph that addresses the actual gap.** It says a missed
  drawing is a delay, not a cancellation, and that entries survive it. It is
  drafted to *preserve* the entrant's expectation rather than extinguish it,
  which is the opposite posture from a discretion clause. Please confirm this
  is the right posture given FL statutes and the states where entry is open.

- **"Reasonable discretion" in (a), not "sole discretion."** The existing
  rules use "sole discretion" for prize substitution. That may be fine there;
  it seemed the wrong standard for terminating the Sweepstakes itself. Please
  confirm the standard you want in each place.

- **(b) explicitly equalizes Method A and Method B.** The AMOE path was
  non-functional in the drawing code until 2026-08-17 — free entries were
  written to storage but never included in the draw. This has been fixed, and
  the equal-treatment language is stated expressly so the rules and the
  implementation now say the same thing.

- **Registration/bonding.** Please confirm whether the aggregate prize value
  across Entry Months triggers registration or bonding in NY, FL, or RI, and
  whether amending posted rules mid-Sweepstakes carries any notice obligation.

- **Prior months.** Please advise separately on June and July 2026, and on the
  April and May 2026 drawings, which were conducted while the free-entry path
  was non-functional. Whether any free entries existed in those months is a
  question of fact that can be answered from the admin sweepstakes preview for
  `2026-04` and `2026-05`; the underlying records are preserved and should not
  be modified.

---

## Change log for this draft

| Date | Change |
|---|---|
| 2026-08-17 | Initial draft prepared for review. Not published. |
