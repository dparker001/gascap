/**
 * DateTimeSplitInput review — the controller behind it must behave EXACTLY like
 * the component did before the quick-save refinements whenever no optional
 * extension is used (the full Rental Setup wizard and Edit Rental), must never
 * lose or revert input on rapid edits, and must keep following a controlled
 * parent value.
 *
 * `OriginalModel` is a line-for-line port of the pre-refactor component
 * (git show 67a7c4c~1:components/rental-return/DateTimeSplitInput.tsx): local
 * date/time state, immediate emit(date, time) from each handler, and the
 * [value] resync guarded by lastEmitted.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { createSplitController, type SplitDraft } from '@/lib/rentalReturnTimeDefault';
import { combineLocalDateTime, splitLocalDateTime } from '@/lib/rentalTimezone';

class OriginalModel {
  date: string; time: string; lastEmitted: string; emitted: string[] = [];
  constructor(value: string) { const s = splitLocalDateTime(value); this.date = s.date; this.time = s.time; this.lastEmitted = value; }
  private emit(d: string, t: string) { const c = combineLocalDateTime(d, t); this.lastEmitted = c; this.emitted.push(c); }
  pickDate(d: string) { this.date = d; this.emit(d, this.time); }
  pickTime(t: string) { this.time = t; this.emit(this.date, t); }
  sync(value: string) { if (value === this.lastEmitted) return; const s = splitLocalDateTime(value); this.date = s.date; this.time = s.time; this.lastEmitted = value; }
}

function newController(value = '', defaultTime?: string) {
  const emitted: string[] = []; const parts: Array<{ date: string; time: string }> = [];
  let drafts: SplitDraft[] = [];
  const ctrl = createSplitController({ value, defaultTime, onChange: (v) => emitted.push(v), onDraft: (d) => drafts.push(d), onParts: (p) => parts.push(p) });
  return { ctrl, emitted, parts, get drafts() { return drafts; } };
}

// ── deterministic pseudo-random event streams ───────────────────────────────
function lcg(seed: number) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32; }
const DATES = ['', '2026-10-20', '2026-10-24', '2026-11-01', '2027-03-14'];
const TIMES = ['', '10:00', '02:30', '01:30', '23:59', '00:00'];
const EXTERNAL = ['', '2026-10-20T10:00', '2026-11-01T01:30', '2027-03-14T02:30'];

describe('1–3. parity with the ORIGINAL component (no extension): the wizard and Edit Rental path', () => {
  for (let seed = 1; seed <= 40; seed++) {
    it(`random event stream #${seed}: identical drafts and identical onChange calls after every step`, () => {
      const rnd = lcg(seed);
      const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
      const start = pick(EXTERNAL);
      const h = newController(start);
      const model = new OriginalModel(start);
      let parentValue = start;
      let syncedParent = start;

      for (let step = 0; step < 60; step++) {
        const r = rnd();
        const before = h.emitted.length;
        if (r < 0.35) { const d = pick(DATES); h.ctrl.pickDate(d); model.pickDate(d); }
        else if (r < 0.7) { const t = pick(TIMES); h.ctrl.pickTime(t); model.pickTime(t); }
        else if (r < 0.85) { parentValue = pick(EXTERNAL); }                                   // an external change
        else { parentValue = parentValue ? `${parentValue.slice(0, 11)}09:00` : parentValue; }   // parent transforms what it holds
        // the parent mirrors the child's latest emission (a controlled input) unless this step was external/transform
        if (h.emitted.length > before) parentValue = h.emitted[h.emitted.length - 1];
        // the [value] effect runs only when the prop CHANGED
        if (parentValue !== syncedParent) { h.ctrl.syncValue(parentValue); model.sync(parentValue); syncedParent = parentValue; }

        const d = h.ctrl.getDraft();
        expect({ date: d.date, time: d.time }, `seed ${seed} step ${step}`).toEqual({ date: model.date, time: model.time });
        expect(h.emitted, `seed ${seed} step ${step}`).toEqual(model.emitted);
      }
    });
  }
});

describe('2. rapid consecutive edits cannot lose or revert input', () => {
  it('date then time back-to-back (before any re-render): both survive', () => {
    const { ctrl, emitted } = newController('');
    ctrl.pickDate('2026-10-24'); ctrl.pickTime('09:00');
    expect(emitted).toEqual(['', '2026-10-24T09:00']);
    expect(ctrl.getDraft()).toMatchObject({ date: '2026-10-24', time: '09:00' });
  });
  it('time then date back-to-back: both survive', () => {
    const { ctrl, emitted } = newController('');
    ctrl.pickTime('09:00'); ctrl.pickDate('2026-10-24');
    expect(emitted.at(-1)).toBe('2026-10-24T09:00');
  });
  it('a burst of alternating edits ends on the last value of each half', () => {
    const { ctrl, emitted } = newController('2026-10-20T10:00');
    for (const [d, t] of [['2026-10-21', '11:00'], ['2026-10-22', '12:00'], ['2026-10-23', '13:00'], ['2026-10-24', '14:00']] as const) { ctrl.pickDate(d); ctrl.pickTime(t); }
    expect(emitted.at(-1)).toBe('2026-10-24T14:00');
    expect(ctrl.getDraft()).toMatchObject({ date: '2026-10-24', time: '14:00' });
  });
  it('the old closure-based handlers WOULD lose the first edit of a burst (why the controller holds the draft itself)', () => {
    // the original handlers read the half they don't edit from the render closure
    const snapshot = { date: '', time: '' };
    const emits: string[] = [];
    const staleDate = (d: string) => emits.push(combineLocalDateTime(d, snapshot.time));
    const staleTime = (t: string) => emits.push(combineLocalDateTime(snapshot.date, t));
    staleDate('2026-10-24'); staleTime('09:00');          // no re-render between → second handler still sees date ''
    expect(emits.at(-1)).toBe('');                         // the date was lost
    const { ctrl, emitted } = newController('');
    ctrl.pickDate('2026-10-24'); ctrl.pickTime('09:00');
    expect(emitted.at(-1)).toBe('2026-10-24T09:00');       // the controller keeps it
  });
  it('emission is immediate and synchronous inside the handler (no deferral to a later effect)', () => {
    const { ctrl, emitted } = newController('');
    ctrl.pickDate('2026-10-24');
    expect(emitted).toEqual(['']);                          // already reported, same tick
    ctrl.pickTime('09:00');
    expect(emitted).toEqual(['', '2026-10-24T09:00']);
  });
});

describe('3. a controlled parent value still synchronizes', () => {
  it('a genuinely different external value replaces the draft (another rental loaded)', () => {
    const { ctrl, parts } = newController('2026-10-20T10:00');
    ctrl.syncValue('2026-12-01T08:30');
    expect(ctrl.getDraft()).toMatchObject({ date: '2026-12-01', time: '08:30' });
    expect(parts.at(-1)).toEqual({ date: '2026-12-01', time: '08:30' });
  });
  it('the round-trip of its OWN emission never clobbers a partial edit', () => {
    const { ctrl, emitted } = newController('');
    ctrl.pickDate('2026-10-24');                            // partial → emitted ''
    expect(emitted).toEqual(['']);
    ctrl.syncValue('');                                      // parent re-renders with the value it was handed
    expect(ctrl.getDraft()).toMatchObject({ date: '2026-10-24', time: '' });
  });
  it('a parent that TRANSFORMS the emitted value wins: the child follows it', () => {
    const { ctrl } = newController('');
    ctrl.pickDate('2026-10-24'); ctrl.pickTime('09:00');    // emitted 2026-10-24T09:00
    ctrl.syncValue('2026-10-24T10:00');                      // e.g. the wizard syncing the return time to the pickup time
    expect(ctrl.getDraft()).toMatchObject({ date: '2026-10-24', time: '10:00' });
    ctrl.pickTime('11:00');                                  // and the next edit builds on THAT
    expect(ctrl.getDraft()).toMatchObject({ date: '2026-10-24', time: '11:00' });
  });
  it('an external clear empties both halves', () => {
    const { ctrl } = newController('2026-10-20T10:00');
    ctrl.syncValue('');
    expect(ctrl.getDraft()).toMatchObject({ date: '', time: '' });
  });
  it('syncing the same value twice is harmless (StrictMode double effects)', () => {
    const { ctrl, emitted } = newController('2026-10-20T10:00');
    ctrl.syncValue('2026-12-01T08:30'); ctrl.syncValue('2026-12-01T08:30');
    expect(ctrl.getDraft()).toMatchObject({ date: '2026-12-01', time: '08:30' });
    expect(emitted).toEqual([]);                             // a resync never emits
  });
});

describe('4. partial input and clearing', () => {
  it('a date alone is kept locally and reports an empty value; the time half survives clearing the date', () => {
    const { ctrl, emitted } = newController('');
    ctrl.pickDate('2026-10-24');
    expect(emitted.at(-1)).toBe('');
    ctrl.pickTime('09:00');
    ctrl.pickDate('');                                       // clear the date
    expect(emitted.at(-1)).toBe('');
    expect(ctrl.getDraft()).toMatchObject({ date: '', time: '09:00' });
  });
  it('clearing either half of a complete value clears the combined value and keeps the other half', () => {
    const a = newController('2026-10-20T10:00'); a.ctrl.pickTime('');
    expect(a.emitted.at(-1)).toBe('');
    expect(a.ctrl.getDraft()).toMatchObject({ date: '2026-10-20', time: '' });
    const b = newController('2026-10-20T10:00'); b.ctrl.pickDate('');
    expect(b.emitted.at(-1)).toBe('');
    expect(b.ctrl.getDraft()).toMatchObject({ date: '', time: '10:00' });
  });
  it('re-entering the missing half completes the value', () => {
    const { ctrl, emitted } = newController('2026-10-20T10:00');
    ctrl.pickTime(''); ctrl.pickTime('15:45');
    expect(emitted.at(-1)).toBe('2026-10-20T15:45');
  });
});

describe('optional Quick-Save extension (default return time)', () => {
  it('without defaultTime it is inert: setDefaultTime(undefined) never changes or emits anything', () => {
    const { ctrl, emitted } = newController('2026-10-20T10:00');
    ctrl.setDefaultTime(undefined);
    expect(ctrl.getDraft()).toMatchObject({ date: '2026-10-20', time: '10:00' });
    expect(emitted).toEqual([]);
  });
  it('a default fills an empty time before any date exists, and reports NO value change (the date is still missing)', () => {
    const { ctrl, emitted } = newController('');
    ctrl.setDefaultTime('10:00');
    expect(ctrl.getDraft()).toMatchObject({ date: '', time: '10:00' });
    expect(emitted).toEqual([]);
    ctrl.pickDate('2026-10-24');
    expect(emitted).toEqual(['2026-10-24T10:00']);
  });
  it('a default that changes a COMPLETE value emits it; a touched time is never replaced', () => {
    const { ctrl, emitted } = newController('', '10:00');
    ctrl.pickDate('2026-10-24');
    expect(emitted.at(-1)).toBe('2026-10-24T10:00');
    ctrl.setDefaultTime('11:30');
    expect(emitted.at(-1)).toBe('2026-10-24T11:30');
    ctrl.pickTime('16:00');
    ctrl.setDefaultTime('08:00');
    expect(emitted.at(-1)).toBe('2026-10-24T16:00');
    expect(ctrl.getDraft().time).toBe('16:00');
  });
  it('an explicit time equal to the default survives later pickup changes (through the controller)', () => {
    const { ctrl, emitted } = newController('', '10:00');
    ctrl.pickDate('2026-10-24');
    ctrl.pickTime('11:00'); ctrl.pickTime('10:00');
    ctrl.setDefaultTime('12:00');
    expect(ctrl.getDraft()).toMatchObject({ date: '2026-10-24', time: '10:00', timeTouched: true });
    expect(emitted.at(-1)).toBe('2026-10-24T10:00');
  });
  it('reports the halves (including a partial entry) through onParts', () => {
    const { ctrl, parts } = newController('');
    ctrl.pickTime('09:00');
    expect(parts.at(-1)).toEqual({ date: '', time: '09:00' });
  });
});

describe('5. the wizard and Edit Rental are on the original path (source guards)', () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');
  it('neither passes any extension prop; the component emits from its handlers, not from an effect', () => {
    for (const f of ['components/rental-return/RentalSetupFlow.tsx', 'components/rental-return/EditRentalModal.tsx']) {
      expect(read(f)).not.toMatch(/dateTimeText|defaultTime|onDateTimeParts|sameAs=|zoneLocked/);
    }
    const c = read('components/rental-return/DateTimeSplitInput.tsx');
    expect(c).toContain('onChange={(e) => ctrl.pickDate(e.target.value)}');
    expect(c).toContain('onChange={(e) => ctrl.pickTime(e.target.value)}');
    expect(c).not.toMatch(/useEffect\(\(\) => \{[^}]*onChange\(/);        // no effect-driven onChange
    expect(c).toContain('ctrl.setDefaultTime(defaultTime)');
  });
  it('the layout contract the existing layout test pins is intact', () => {
    const c = read('components/rental-return/DateTimeSplitInput.tsx');
    expect(c).toContain('grid grid-cols-1 sm:grid-cols-2 gap-2');
    expect(c).toContain('rental-datetime-input min-w-0');
  });
});
