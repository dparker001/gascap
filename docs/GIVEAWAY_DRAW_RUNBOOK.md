# Monthly Giveaway Drawing — Run-book

**Status: CURRENT** — the procedure once `fix/giveaway-draw-et-guard` (WS-1) is deployed.
**Design:** `docs/reviews/2026-10-05-drawing-integrity-rev4.md` Part 1, as amended by `…-rev5.md` Part 1.
**Code:** `lib/giveawayPeriod.ts`, `commitDraw()` in `lib/giveaway.ts`, `app/api/cron/giveaway-draw/route.ts`, `app/api/admin/sweepstakes/route.ts`.

All times are Eastern (ET). Cron expressions are UTC.

## Safeguards the code enforces
| Rule | Effect |
|---|---|
| ET close | No Entry Month can be recorded before **12:00:00 AM ET on the 1st** of the next month (cron or admin). |
| Fail-closed switch | The cron draws only when `GIVEAWAY_AUTO_DRAW` is exactly `on`. Unset means **no automatic draw**. `?force=1` no longer exists. |
| 72-hour window | The cron records a month only within 72 h of its close. After that it skips (`outside_auto_window`), and the daily integrity check reports `missing-draw`. |
| Latest closed month only | Admin and cron can record only the most recently closed month. Older months are always refused (`historical_month_requires_approval`); no corrective drawing exists in code. |
| Explicit month | Every admin POST (record, dry run, `send-winner-email`) requires `month`; there is no current-month default. |
| One draw per month | The draw and the period-counter reset commit in one transaction. A request that loses a race gets `already_drawn` and resets and sends nothing. |
| AMOE month | Free entries are filed under the ET month; one per person per ET month. |

**Schedule (unchanged):** `.github/workflows/crons.yml`, `50 23 * * *` = 7:50 PM EDT / 6:50 PM EST daily.

## October 2026 procedure (`GIVEAWAY_AUTO_DRAW` unset)
**Before step 3, both boxes must be checked:**

> October 2026 is drawn with known legacy-accounting limitations:
> - counters include ~26 h of late-September credits (the September draw ran early);
> - they may include minutes of November credits, which the draw then resets;
> - activity day keys are device-local or UTC-fallback dates, not ET;
> - eligibility and the referral multiplier are read at draw time, not at the close;
> - increments between pool calculation and the reset are erased.
>
> ☐ Don accepts these limitations for October. ☐ Counsel has reviewed or been informed (date: ____).

1. **After deploy (by Oct 29, outside 9:45–10:15 AM ET):**
   - confirm `GIVEAWAY_AUTO_DRAW` is unset in Railway (read-only check);
   - the next 7:50 PM ET cron log shows `"reason":"auto-draw disabled"`.
2. **Oct 31:** no action. Free entries until 11:59:59 PM ET are filed under October.
3. **Nov 1, at or after 12:00:30 AM EDT,** in the admin panel (`/admin/sweepstakes`):
   - **Select October 2026 explicitly.** The panel's month picker defaults to the UTC month, which is already November. A November attempt is refused with `month_open` (harmless).
   - Run **Dry Run** first (records nothing).
   - Then **Draw Winner** with "Hold for review" (the default).
4. Verify the winner, then release emails with the winner-card button (it sends `month` explicitly).
5. Archive the dry-run and record responses (pool size, total entries, winner entry count) for counsel.

## Error codes (admin panel shows the message)
| Code | HTTP | Meaning / action |
|---|---|---|
| `month_open` | 422 | The month hasn't closed in ET yet. Wait for 12:00 AM ET on the 1st. |
| `historical_month_requires_approval` | 422 | Not the latest closed month. Stop: needs counsel and a separate mechanism. |
| `late_draw_requires_approval` | 422 | More than 72 h after the close. Follow **Late draw** below. |
| `already_drawn` | 409 | The month is recorded; the panel shows it. |
| `outside_auto_window` | cron 200 skip | The cron is past the window; the integrity check reports it. |

## Late draw (latest closed month, more than 72 h after its close)
A reference is **audit evidence, not authorization**: the server can't verify who approved. The authorization is Don's written approval, which must exist **before** the request.

1. **Don writes a dated approval:** `docs/reviews/approvals/<YYYY-MM-DD>-late-draw-<YYYY-MM>.md` (or a GitHub issue) with the month, the reason, and counsel's acknowledgement.
2. **Admin POST**, using the API (the panel doesn't expose these fields), with the admin password header from your password manager:
   ```json
   { "month": "2026-10",
     "notes": "<your notes>",
     "lateDrawApprovalRef": "approvals/2026-11-06-late-draw-2026-10.md",
     "confirmMonth": "2026-10" }
   ```
   - The ref must be 6–128 characters of letters, digits and `. _ : / # -`: no spaces, emails or free text.
   - `confirmMonth` must repeat `month`.
3. The stored notes are your notes verbatim, then `[late-draw-approval-ref: …; recorded <ISO>]`.
4. Engineering verifies that the approval record existed when reviewing the draw log.

## Enabling the automatic draw later
Setting `GIVEAWAY_AUTO_DRAW=on` in Railway is a **separately authorized configuration change**. When on:
- the cron draws the latest closed month at its first run after the ET close: the 1st, 7:50 PM ET, about 20 h after the close, well inside 72 h;
- it retries on the next two daily runs if needed.

The integrity check's `missing-draw` finding is silent for 72 h after each close, then fires if no draw exists. `GIVEAWAY_PAUSED=true` still silences it during an intentional pause; it does **not** stop a draw.
