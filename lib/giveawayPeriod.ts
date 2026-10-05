/**
 * Entry Month timing for the monthly giveaway — the ONLY place drawing paths
 * decide what month it is or whether a month may be drawn.
 *
 * The Official Rules (app/sweepstakes-rules/page.tsx) define an Entry Month as
 * 12:00:00 AM to 11:59:59 PM **Eastern Time**. The previous implementation used
 * the UTC month and a UTC last-day guard, so a GitHub Actions run delayed past
 * 00:00Z drew August and September ~26 hours before their published close
 * (docs/reviews/2026-10-05-monthly-drawing-integrity-emergency-review.md).
 *
 * Invariant enforced here for both the cron and the admin panel:
 *   No Entry Month is recorded before 12:00:00 AM ET on the 1st of the
 *   following month.
 *
 * Pure (no I/O) so every boundary — EDT, EST, the DST changeover days, year
 * end — is unit-testable. America/New_York via Intl handles DST.
 */

export const ENTRY_TIME_ZONE = 'America/New_York';

/** How long after a month closes the automatic cron may still record it. */
export const AUTO_WINDOW_MS = 72 * 60 * 60 * 1000;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Approval refs are identifiers (a file name, issue number), never free text, PII or secrets. */
const APPROVAL_REF_RE = /^[A-Za-z0-9._:/#-]{6,128}$/;

const etFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ENTRY_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});

interface EtParts { y: number; m: number; d: number; hh: number; mm: number; ss: number }

function etParts(instant: Date): EtParts {
  const p: Record<string, number> = {};
  for (const { type, value } of etFormatter.formatToParts(instant)) {
    if (type !== 'literal') p[type] = Number(value);
  }
  return { y: p.year, m: p.month, d: p.day, hh: p.hour, mm: p.minute, ss: p.second };
}

/** ET wall-clock minus UTC, in ms, at `instant` (−4h in EDT, −5h in EST). */
function etOffsetMs(instant: Date): number {
  const p = etParts(instant);
  const wallAsUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return wallAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;

export function isValidEntryMonth(month: unknown): month is string {
  return typeof month === 'string' && MONTH_RE.test(month);
}

export function previousEntryMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? monthKey(y - 1, 12) : monthKey(y, m - 1);
}

export function nextEntryMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? monthKey(y + 1, 1) : monthKey(y, m + 1);
}

/** The Entry Month (ET calendar month) that `now` falls in. */
export function currentEntryMonthET(now: Date = new Date()): string {
  const p = etParts(now);
  return monthKey(p.y, p.m);
}

/**
 * First instant AFTER the Entry Month: 12:00:00.000 AM ET on the 1st of the
 * next month (exclusive end). Midnight is never inside a DST gap — US
 * transitions happen at 2 AM — so the offset at that instant is unambiguous.
 */
export function entryMonthCloseInstant(month: string): Date {
  const [y, m] = nextEntryMonth(month).split('-').map(Number);
  const midnightAsUtc = Date.UTC(y, m - 1, 1, 0, 0, 0);
  // Resolve the offset at the candidate instant; a second pass settles it.
  let instant = midnightAsUtc - etOffsetMs(new Date(midnightAsUtc));
  instant = midnightAsUtc - etOffsetMs(new Date(instant));
  return new Date(instant);
}

export function isEntryMonthClosed(month: string, now: Date = new Date()): boolean {
  return now.getTime() >= entryMonthCloseInstant(month).getTime();
}

/** The most recent Entry Month whose published deadline has passed. */
export function latestClosedEntryMonthET(now: Date = new Date()): string {
  return previousEntryMonth(currentEntryMonthET(now));
}

/** True only in [close, close + 72h) — the automatic cron's execution window. */
export function isWithinAutoWindow(month: string, now: Date = new Date()): boolean {
  const close = entryMonthCloseInstant(month).getTime();
  return now.getTime() >= close && now.getTime() < close + AUTO_WINDOW_MS;
}

export type EntryMonthState = 'open' | 'closed' | 'historical';

/** Read-only label for dry runs and previews. Never gates anything by itself. */
export function entryMonthState(month: string, now: Date = new Date()): EntryMonthState {
  if (!isEntryMonthClosed(month, now)) return 'open';
  return month === latestClosedEntryMonthET(now) ? 'closed' : 'historical';
}

export function isValidLateDrawApprovalRef(ref: unknown): ref is string {
  return typeof ref === 'string' && APPROVAL_REF_RE.test(ref);
}

export type RecordRefusalCode =
  | 'invalid_month'
  | 'month_open'
  | 'historical_month_requires_approval'
  | 'already_drawn'
  | 'outside_auto_window'
  | 'late_draw_requires_approval';

export type RecordCheck =
  | { ok: true; late: boolean }
  | { ok: false; code: RecordRefusalCode; message: string };

export interface RecordOptions {
  mode: 'auto' | 'admin';
  /** Admin late recovery only — audit evidence of Don's written approval, not authorization itself. */
  lateDrawApprovalRef?: unknown;
  /** Admin late recovery only — must repeat `month` exactly. */
  confirmMonth?: unknown;
}

/**
 * Whether `month` may be RECORDED as a drawing right now. Shared by the cron
 * and the admin panel; checks run in a fixed order so the most fundamental
 * refusal is the one reported.
 *
 * A historical month (anything older than the latest closed month) is refused
 * regardless of any approval ref: no corrective drawing has a code path here.
 */
export function assertRecordableEntryMonth(
  month: unknown,
  now: Date,
  drawnMonths: Iterable<string>,
  opts: RecordOptions,
): RecordCheck {
  if (!isValidEntryMonth(month)) {
    return { ok: false, code: 'invalid_month', message: 'Invalid month format. Use YYYY-MM.' };
  }
  if (!isEntryMonthClosed(month, now)) {
    return {
      ok: false, code: 'month_open',
      message: `${month} is still open — its Entry Month ends 11:59:59 PM Eastern Time. It can be drawn from ${entryMonthCloseInstant(month).toISOString()} (12:00 AM ET).`,
    };
  }
  if (month !== latestClosedEntryMonthET(now)) {
    return {
      ok: false, code: 'historical_month_requires_approval',
      message: `${month} is not the most recently closed Entry Month. Historical or corrective drawings require separate, counsel-reviewed authorization and are not available here.`,
    };
  }
  for (const drawn of Array.from(drawnMonths)) {
    if (drawn === month) {
      return { ok: false, code: 'already_drawn', message: `Draw already run for ${month}.` };
    }
  }
  if (isWithinAutoWindow(month, now)) return { ok: true, late: false };

  if (opts.mode === 'auto') {
    return {
      ok: false, code: 'outside_auto_window',
      message: `${month} closed more than 72 hours ago; the automatic draw no longer runs it. A late draw needs Don's written approval and the admin recovery path.`,
    };
  }
  if (!isValidLateDrawApprovalRef(opts.lateDrawApprovalRef) || opts.confirmMonth !== month) {
    return {
      ok: false, code: 'late_draw_requires_approval',
      message: `${month} closed more than 72 hours ago. A late draw requires Don's dated written approval: pass lateDrawApprovalRef (its identifier, 6–128 chars of letters, digits and . _ : / # -) and confirmMonth equal to the month.`,
    };
  }
  return { ok: true, late: true };
}

/**
 * Notes for a late draw: the admin's original notes verbatim, then the
 * approval reference on its own line. The ref is stored, never interpreted.
 */
export function lateDrawNotes(notes: string | undefined, ref: string, now: Date = new Date()): string {
  const tag = `[late-draw-approval-ref: ${ref}; recorded ${now.toISOString()}]`;
  return notes ? `${notes}\n${tag}` : tag;
}
