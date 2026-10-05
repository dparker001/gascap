/**
 * WS-1 (Oct 31 emergency safeguards): Entry Month timing in America/New_York.
 * Invariant: no Entry Month is recordable before 12:00:00 AM ET on the 1st of
 * the next month. Boundaries cover EDT, EST, both DST changeovers and year end.
 * See docs/reviews/2026-10-05-drawing-integrity-rev4.md / rev5.md Part 1.
 */
import { describe, it, expect } from 'vitest';
import {
  currentEntryMonthET, entryMonthCloseInstant, isEntryMonthClosed, latestClosedEntryMonthET,
  isWithinAutoWindow, entryMonthState, assertRecordableEntryMonth, isValidLateDrawApprovalRef,
  lateDrawNotes, previousEntryMonth, nextEntryMonth, AUTO_WINDOW_MS,
} from '@/lib/giveawayPeriod';

const t = (iso: string) => new Date(iso);
const H = 3600_000;

describe('ET close instants (DST-aware)', () => {
  it('October (EDT) closes at 2026-11-01T04:00:00Z — Oct 31 11:59:59 PM EDT is still open', () => {
    expect(entryMonthCloseInstant('2026-10').toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(isEntryMonthClosed('2026-10', t('2026-11-01T03:59:59.999Z'))).toBe(false);
    expect(isEntryMonthClosed('2026-10', t('2026-11-01T04:00:00.000Z'))).toBe(true);
  });

  it('November (EST) closes at 2026-12-01T05:00:00Z', () => {
    expect(entryMonthCloseInstant('2026-11').toISOString()).toBe('2026-12-01T05:00:00.000Z');
    expect(isEntryMonthClosed('2026-11', t('2026-12-01T04:59:59.999Z'))).toBe(false);
    expect(isEntryMonthClosed('2026-11', t('2026-12-01T05:00:00.000Z'))).toBe(true);
  });

  it('spring-forward: Feb 2027 closes 05:00Z (EST), March 2027 closes 04:00Z (EDT)', () => {
    expect(entryMonthCloseInstant('2027-02').toISOString()).toBe('2027-03-01T05:00:00.000Z');
    expect(entryMonthCloseInstant('2027-03').toISOString()).toBe('2027-04-01T04:00:00.000Z');
  });

  it('year end: December closes at Jan 1 00:00 EST', () => {
    expect(entryMonthCloseInstant('2026-12').toISOString()).toBe('2027-01-01T05:00:00.000Z');
    expect(latestClosedEntryMonthET(t('2027-01-01T05:00:00Z'))).toBe('2026-12');
    expect(latestClosedEntryMonthET(t('2027-01-01T04:59:59Z'))).toBe('2026-11');
  });

  it('the old UTC logic would have treated these instants as the next month', () => {
    // 8:00 PM EDT Oct 31 is already "2026-11" in UTC — it must be October.
    expect(currentEntryMonthET(t('2026-11-01T00:00:00Z'))).toBe('2026-10');
    expect(currentEntryMonthET(t('2026-11-01T03:59:59Z'))).toBe('2026-10');
    expect(currentEntryMonthET(t('2026-11-01T04:00:00Z'))).toBe('2026-11');
  });

  it('DST fall-back repeated hour (Nov 1 01:00–02:00) is November', () => {
    expect(currentEntryMonthET(t('2026-11-01T05:30:00Z'))).toBe('2026-11'); // 1:30 AM EDT
    expect(currentEntryMonthET(t('2026-11-01T06:30:00Z'))).toBe('2026-11'); // 1:30 AM EST
  });

  it('DST spring-forward skipped hour (Mar 14 2027) is March', () => {
    expect(currentEntryMonthET(t('2027-03-14T06:59:59Z'))).toBe('2027-03'); // 1:59:59 AM EST
    expect(currentEntryMonthET(t('2027-03-14T07:00:00Z'))).toBe('2027-03'); // 3:00 AM EDT
  });

  it('month arithmetic wraps years', () => {
    expect(previousEntryMonth('2027-01')).toBe('2026-12');
    expect(nextEntryMonth('2026-12')).toBe('2027-01');
  });
});

describe('72-hour automatic window', () => {
  const close = entryMonthCloseInstant('2026-10').getTime();
  it('is [close, close + 72h)', () => {
    expect(AUTO_WINDOW_MS).toBe(72 * H);
    expect(isWithinAutoWindow('2026-10', new Date(close - 1))).toBe(false);
    expect(isWithinAutoWindow('2026-10', new Date(close))).toBe(true);
    expect(isWithinAutoWindow('2026-10', new Date(close + 72 * H - 1))).toBe(true);
    expect(isWithinAutoWindow('2026-10', new Date(close + 72 * H))).toBe(false);
  });
  it('the first scheduled cron after the October close (Nov 1 23:50Z) is inside it', () => {
    expect(isWithinAutoWindow('2026-10', t('2026-11-01T23:50:00Z'))).toBe(true);
  });
  it('November window uses the EST close', () => {
    expect(isWithinAutoWindow('2026-11', t('2026-12-01T04:59:59Z'))).toBe(false);
    expect(isWithinAutoWindow('2026-11', t('2026-12-04T04:59:59Z'))).toBe(true);
    expect(isWithinAutoWindow('2026-11', t('2026-12-04T05:00:00Z'))).toBe(false);
  });
});

describe('assertRecordableEntryMonth — refusal order', () => {
  const inWindow = t('2026-11-01T04:00:30Z');
  const late     = t('2026-11-06T12:00:00Z');
  const auto  = { mode: 'auto' as const };
  const admin = { mode: 'admin' as const };

  it('invalid month', () => {
    for (const m of [undefined, '', '2026-13', '2026-1', 'legacy', 202610]) {
      expect(assertRecordableEntryMonth(m, inWindow, [], admin)).toMatchObject({ ok: false, code: 'invalid_month' });
    }
  });
  it('open month is refused for both modes — even one millisecond before the close', () => {
    const before = t('2026-11-01T03:59:59.999Z');
    expect(assertRecordableEntryMonth('2026-10', before, [], auto)).toMatchObject({ ok: false, code: 'month_open' });
    expect(assertRecordableEntryMonth('2026-10', before, [], admin)).toMatchObject({ ok: false, code: 'month_open' });
    expect(assertRecordableEntryMonth('2026-11', inWindow, [], admin)).toMatchObject({ ok: false, code: 'month_open' });
  });
  it('historical months are refused even with a valid approval ref', () => {
    const r = assertRecordableEntryMonth('2026-07', inWindow, [], {
      mode: 'admin', lateDrawApprovalRef: 'docs/reviews/approvals/2026-11-02-late-draw-2026-07.md', confirmMonth: '2026-07',
    });
    expect(r).toMatchObject({ ok: false, code: 'historical_month_requires_approval' });
  });
  it('already drawn', () => {
    expect(assertRecordableEntryMonth('2026-10', inWindow, ['2026-09', '2026-10'], admin)).toMatchObject({ ok: false, code: 'already_drawn' });
  });
  it('in window: auto and admin may record', () => {
    expect(assertRecordableEntryMonth('2026-10', inWindow, ['2026-09'], auto)).toEqual({ ok: true, late: false });
    expect(assertRecordableEntryMonth('2026-10', inWindow, ['2026-09'], admin)).toEqual({ ok: true, late: false });
  });
  it('after the window: auto refuses; admin needs a valid ref AND confirmMonth', () => {
    expect(assertRecordableEntryMonth('2026-10', late, [], auto)).toMatchObject({ ok: false, code: 'outside_auto_window' });
    expect(assertRecordableEntryMonth('2026-10', late, [], admin)).toMatchObject({ ok: false, code: 'late_draw_requires_approval' });
    const ref = 'approvals/2026-11-06-late-draw-2026-10.md';
    expect(assertRecordableEntryMonth('2026-10', late, [], { mode: 'admin', lateDrawApprovalRef: ref }))
      .toMatchObject({ ok: false, code: 'late_draw_requires_approval' });
    expect(assertRecordableEntryMonth('2026-10', late, [], { mode: 'admin', lateDrawApprovalRef: ref, confirmMonth: '2026-11' }))
      .toMatchObject({ ok: false, code: 'late_draw_requires_approval' });
    expect(assertRecordableEntryMonth('2026-10', late, [], { mode: 'admin', lateDrawApprovalRef: ref, confirmMonth: '2026-10' }))
      .toEqual({ ok: true, late: true });
  });
  it('auto mode ignores any approval ref', () => {
    expect(assertRecordableEntryMonth('2026-10', late, [], {
      mode: 'auto', lateDrawApprovalRef: 'approvals/x-2026-10', confirmMonth: '2026-10',
    })).toMatchObject({ ok: false, code: 'outside_auto_window' });
  });
});

describe('late-draw approval ref (C1: audit evidence, never free text / PII)', () => {
  it('accepts identifiers', () => {
    for (const r of ['approvals/2026-11-06-late-draw-2026-10.md', 'gh#123456', 'DON-2026-11-06']) {
      expect(isValidLateDrawApprovalRef(r)).toBe(true);
    }
  });
  it('rejects emails, spaces, short, long and non-strings', () => {
    for (const r of ['a@b.com', 'approved by don', 'abc', 'x'.repeat(129), '', undefined, 42, 'ref;drop']) {
      expect(isValidLateDrawApprovalRef(r)).toBe(false);
    }
  });
  it('preserves the original notes byte-for-byte as a prefix', () => {
    const now = t('2026-11-06T12:00:00Z');
    const original = '  Winner verified by phone.\nSecond line  ';
    const out = lateDrawNotes(original, 'gh#123456', now);
    expect(out.startsWith(original)).toBe(true);
    expect(out).toBe(`${original}\n[late-draw-approval-ref: gh#123456; recorded 2026-11-06T12:00:00.000Z]`);
    expect(lateDrawNotes(undefined, 'gh#123456', now)).toBe('[late-draw-approval-ref: gh#123456; recorded 2026-11-06T12:00:00.000Z]');
  });
});

describe('entryMonthState (dry-run label only)', () => {
  const now = t('2026-11-01T04:00:30Z');
  it('labels open / closed / historical', () => {
    expect(entryMonthState('2026-11', now)).toBe('open');
    expect(entryMonthState('2026-10', now)).toBe('closed');
    expect(entryMonthState('2026-09', now)).toBe('historical');
  });
});
