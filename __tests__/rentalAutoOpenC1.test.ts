/** C1 — opt-in, device-local auto-open: the decision and the storage. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  decideAutoOpen, autoOpenOnceKey, isAutoOpenEnabled, setAutoOpenEnabled, hasAutoOpenOnceFlag, setAutoOpenOnceFlag,
  AUTO_OPEN_ENABLED_KEY, AUTO_OPEN_MIN_BACKGROUND_MS, type AutoOpenRental,
} from '@/lib/rentalAutoOpen';

const pickup = (id: string, key = '2026-10-10T14:00:00.000Z'): AutoOpenRental => ({ id, lifecycle: 'pickup', pickupKey: key });
const other = (id: string, lifecycle: AutoOpenRental['lifecycle']): AutoOpenRental => ({ id, lifecycle, pickupKey: 'k' });
const input = (over: Partial<Parameters<typeof decideAutoOpen>[0]> = {}) => ({
  enabled: true, pathname: '/', typing: false, trigger: 'cold_start' as const, backgroundedMs: 0,
  rentals: [pickup('a')], hasOnceFlag: () => false, ...over,
});

describe('decideAutoOpen', () => {
  it('opens the single rental at pickup, once, with a key that includes the pickup instant', () => {
    expect(decideAutoOpen(input())).toEqual({ action: 'open', rentalId: 'a', onceKey: autoOpenOnceKey('a', '2026-10-10T14:00:00.000Z') });
  });
  it('is off by default / when disabled', () => {
    expect(decideAutoOpen(input({ enabled: false }))).toEqual({ action: 'none', reason: 'disabled' });
  });
  it('only from the home route — never mid-form, checkout or on a rental page', () => {
    for (const p of ['/rental-return', '/rental-return/a', '/upgrade', '/settings', '/?x=1', '']) {
      expect(decideAutoOpen(input({ pathname: p }))).toEqual({ action: 'none', reason: 'wrong_route' });
    }
  });
  it('never while the renter is typing', () => {
    expect(decideAutoOpen(input({ typing: true }))).toEqual({ action: 'none', reason: 'typing' });
  });
  it('a resume counts only after ≥ 5 minutes away (boundary), a cold start always counts', () => {
    expect(decideAutoOpen(input({ trigger: 'resume', backgroundedMs: AUTO_OPEN_MIN_BACKGROUND_MS - 1 }))).toEqual({ action: 'none', reason: 'too_soon_after_resume' });
    expect(decideAutoOpen(input({ trigger: 'resume', backgroundedMs: AUTO_OPEN_MIN_BACKGROUND_MS })).action).toBe('open');
    expect(decideAutoOpen(input({ trigger: 'cold_start', backgroundedMs: 0 })).action).toBe('open');
  });
  it('only the pickup state qualifies — never upcoming, active, near_return, overdue, stale, needs_schedule', () => {
    for (const lc of ['upcoming', 'active', 'near_return', 'overdue', 'stale', 'needs_schedule', 'completed', 'cancelled'] as const) {
      expect(decideAutoOpen(input({ rentals: [other('x', lc)] }))).toEqual({ action: 'none', reason: 'no_pickup_rental' });
    }
  });
  it('two or more rentals at pickup → never picks one for the renter', () => {
    expect(decideAutoOpen(input({ rentals: [pickup('a'), pickup('b')] }))).toEqual({ action: 'none', reason: 'multiple_pickup_rentals' });
    // …but one pickup rental alongside non-pickup ones is still unambiguous
    expect(decideAutoOpen(input({ rentals: [pickup('a'), other('b', 'active'), other('c', 'upcoming')] })).action).toBe('open');
  });
  it('once per rental + pickup instant: a rescheduled pickup may open once more', () => {
    const seen = new Set([autoOpenOnceKey('a', '2026-10-10T14:00:00.000Z')]);
    const has = (k: string) => seen.has(k);
    expect(decideAutoOpen(input({ hasOnceFlag: has }))).toEqual({ action: 'none', reason: 'already_opened' });
    expect(decideAutoOpen(input({ hasOnceFlag: has, rentals: [pickup('a', '2026-10-11T14:00:00.000Z')] })).action).toBe('open');
  });
});

describe('device-local storage fails OFF', () => {
  const g = globalThis as unknown as { window?: unknown };
  const before = g.window;
  afterEach(() => { g.window = before; });

  it('without a window (server) it is disabled and writes nothing', () => {
    g.window = undefined;
    expect(isAutoOpenEnabled()).toBe(false);
    expect(() => setAutoOpenEnabled(true)).not.toThrow();
  });
  it('a throwing localStorage never throws and reads as disabled / not-opened', () => {
    g.window = { get localStorage(): Storage { throw new Error('blocked'); } };
    expect(isAutoOpenEnabled()).toBe(false);
    expect(hasAutoOpenOnceFlag('k')).toBe(false);
    expect(() => { setAutoOpenEnabled(true); setAutoOpenOnceFlag('k'); }).not.toThrow();
  });
  describe('with a working store', () => {
    let data: Record<string, string>;
    beforeEach(() => {
      data = {};
      g.window = { localStorage: { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; }, removeItem: (k: string) => { delete data[k]; } } };
    });
    it('is OFF by default; on/off round-trips; the value is device-local only', () => {
      expect(isAutoOpenEnabled()).toBe(false);
      setAutoOpenEnabled(true);
      expect(data[AUTO_OPEN_ENABLED_KEY]).toBe('1');
      expect(isAutoOpenEnabled()).toBe(true);
      setAutoOpenEnabled(false);
      expect(isAutoOpenEnabled()).toBe(false);
    });
    it('once flags persist per key', () => {
      const k = autoOpenOnceKey('a', 'x');
      expect(hasAutoOpenOnceFlag(k)).toBe(false);
      setAutoOpenOnceFlag(k);
      expect(hasAutoOpenOnceFlag(k)).toBe(true);
      expect(hasAutoOpenOnceFlag(autoOpenOnceKey('a', 'y'))).toBe(false);
    });
  });
});

describe('wiring (source guards)', () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');
  it('the setting is device-local: no profile/server write', () => {
    const f = read('components/RentalAutoOpenSetting.tsx');
    expect(f).toContain('setAutoOpenEnabled');
    expect(f).not.toMatch(/fetch\(|api\/user\/profile/);
  });
  it('the opener only navigates — it never writes a rental, fuel reading or user mode', () => {
    const f = read('components/RentalAutoOpen.tsx');
    expect(f).toContain("fetch('/api/rental-sessions?status=active')");   // a read
    expect(f).not.toMatch(/method:\s*'(POST|PATCH|PUT|DELETE)'|userMode|gc:user-mode/);
    expect(read('app/layout.tsx')).toContain('<RentalAutoOpen />');
  });
  it('only fetches when it could actually open (enabled, home route) — no network for everyone else', () => {
    const f = read('components/RentalAutoOpen.tsx');
    expect(f.indexOf('isAutoOpenEnabled()')).toBeGreaterThan(-1);
    expect(f.indexOf('isAutoOpenEnabled()')).toBeLessThan(f.indexOf('fetch('));
  });
  it('the multi-pickup banner text exists in EN and ES', () => {
    const t = read('lib/translations.ts');
    expect((t.match(/rentalModeAtPickupMultiple/g) ?? []).length).toBe(2);
  });
});
