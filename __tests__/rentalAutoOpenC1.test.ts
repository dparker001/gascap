/** C1 — opt-in, device-local auto-open: the decision and the storage. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  decideAutoOpen, autoOpenOnceKey, isAutoOpenEnabled, setAutoOpenEnabled, hasAutoOpenOnceFlag, setAutoOpenOnceFlag,
  autoOpenEnabledKey, canNavigateAfterCheck, AUTO_OPEN_MIN_BACKGROUND_MS, type AutoOpenRental,
} from '@/lib/rentalAutoOpen';

const pickup = (id: string, key = '2026-10-10T14:00:00.000Z'): AutoOpenRental => ({ id, lifecycle: 'pickup', pickupKey: key });
const other = (id: string, lifecycle: AutoOpenRental['lifecycle']): AutoOpenRental => ({ id, lifecycle, pickupKey: 'k' });
const input = (over: Partial<Parameters<typeof decideAutoOpen>[0]> = {}): Parameters<typeof decideAutoOpen>[0] => ({
  userId: 'u1', enabled: true, pathname: '/', typing: false, trigger: 'cold_start' as const, backgroundedMs: 0,
  rentals: [pickup('a')], hasOnceFlag: () => false, ...over,
});

describe('decideAutoOpen', () => {
  it('opens the single rental at pickup, once, with a key that includes the pickup instant', () => {
    expect(decideAutoOpen(input())).toEqual({ action: 'open', rentalId: 'a', onceKey: autoOpenOnceKey('u1', 'a', '2026-10-10T14:00:00.000Z') });
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
    const seen = new Set([autoOpenOnceKey('u1', 'a', '2026-10-10T14:00:00.000Z')]);
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
    expect(isAutoOpenEnabled('u1')).toBe(false);
    expect(() => setAutoOpenEnabled('u1', true)).not.toThrow();
  });
  it('a throwing localStorage never throws and reads as disabled / not-opened', () => {
    g.window = { get localStorage(): Storage { throw new Error('blocked'); } };
    expect(isAutoOpenEnabled('u1')).toBe(false);
    expect(hasAutoOpenOnceFlag('k')).toBe(false);
    expect(() => { setAutoOpenEnabled('u1', true); setAutoOpenOnceFlag('k'); }).not.toThrow();
  });
  it('no signed-in account → always off, and nothing is written', () => {
    const data: Record<string, string> = {};
    g.window = { localStorage: { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; }, removeItem: (k: string) => { delete data[k]; } } };
    for (const none of [null, undefined, '']) {
      setAutoOpenEnabled(none, true);
      expect(isAutoOpenEnabled(none)).toBe(false);
    }
    expect(Object.keys(data)).toEqual([]);
  });
  describe('with a working store', () => {
    let data: Record<string, string>;
    beforeEach(() => {
      data = {};
      g.window = { localStorage: { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; }, removeItem: (k: string) => { delete data[k]; } } };
    });
    it('is OFF by default; on/off round-trips under a per-account key', () => {
      expect(isAutoOpenEnabled('u1')).toBe(false);
      setAutoOpenEnabled('u1', true);
      expect(data[autoOpenEnabledKey('u1')]).toBe('1');
      expect(isAutoOpenEnabled('u1')).toBe(true);
      setAutoOpenEnabled('u1', false);
      expect(isAutoOpenEnabled('u1')).toBe(false);
    });
    it('CONSENT IS ACCOUNT-SPECIFIC: one account enabling it never enables it for another on the same device', () => {
      setAutoOpenEnabled('alice', true);
      expect(isAutoOpenEnabled('alice')).toBe(true);
      expect(isAutoOpenEnabled('bob')).toBe(false);
      setAutoOpenEnabled('bob', true);
      setAutoOpenEnabled('alice', false);               // alice turning it off leaves bob's choice alone
      expect(isAutoOpenEnabled('alice')).toBe(false);
      expect(isAutoOpenEnabled('bob')).toBe(true);
    });
    it('the old un-keyed (global) flag grants nothing to anyone', () => {
      data['gc_rental_autoopen_enabled'] = '1';
      expect(isAutoOpenEnabled('alice')).toBe(false);
    });
    it('once flags are per account + rental + pickup instant', () => {
      const k = autoOpenOnceKey('alice', 'a', 'x');
      expect(hasAutoOpenOnceFlag(k)).toBe(false);
      setAutoOpenOnceFlag(k);
      expect(hasAutoOpenOnceFlag(k)).toBe(true);
      expect(hasAutoOpenOnceFlag(autoOpenOnceKey('bob', 'a', 'x'))).toBe(false);
      expect(hasAutoOpenOnceFlag(autoOpenOnceKey('alice', 'a', 'y'))).toBe(false);
    });
  });
});

describe('decideAutoOpen requires an account', () => {
  it('an empty user id is disabled even if "enabled" were passed true', () => {
    expect(decideAutoOpen(input({ userId: '' }))).toEqual({ action: 'none', reason: 'disabled' });
  });
  it("the once key it returns is the account's own", () => {
    expect(decideAutoOpen(input({ userId: 'bob' }))).toMatchObject({ onceKey: autoOpenOnceKey('bob', 'a', '2026-10-10T14:00:00.000Z') });
  });
});

describe('canNavigateAfterCheck — stale asynchronous checks never navigate', () => {
  const ok = { requestedUserId: 'u1', currentUserId: 'u1', requestedGeneration: 3, currentGeneration: 3, aborted: false, currentPathname: '/', typing: false, enabledNow: true };
  it('navigates only when every condition still holds', () => {
    expect(canNavigateAfterCheck(ok)).toBe(true);
  });
  it('logout (no current account) → no', () => {
    expect(canNavigateAfterCheck({ ...ok, currentUserId: null })).toBe(false);
  });
  it('a different account signed in → no', () => {
    expect(canNavigateAfterCheck({ ...ok, currentUserId: 'u2' })).toBe(false);
  });
  it('superseded by a newer check / logout / account change / unmount (generation moved) → no', () => {
    expect(canNavigateAfterCheck({ ...ok, currentGeneration: 4 })).toBe(false);
  });
  it('aborted → no', () => {
    expect(canNavigateAfterCheck({ ...ok, aborted: true })).toBe(false);
  });
  it('the renter navigated away before the response → no', () => {
    for (const p of ['/rental-return', '/settings', '/upgrade', '/rental-return/abc']) {
      expect(canNavigateAfterCheck({ ...ok, currentPathname: p })).toBe(false);
    }
  });
  it('the renter started typing while it was in flight → no', () => {
    expect(canNavigateAfterCheck({ ...ok, typing: true })).toBe(false);
  });
  it('the setting was disabled while it was in flight → no', () => {
    expect(canNavigateAfterCheck({ ...ok, enabledNow: false })).toBe(false);
  });
  it('an empty requested account never navigates', () => {
    expect(canNavigateAfterCheck({ ...ok, requestedUserId: '', currentUserId: '' })).toBe(false);
  });
});

describe('wiring (source guards)', () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');
  it('the setting is device-local and per account: no profile/server write, keyed by the signed-in user id', () => {
    const f = read('components/RentalAutoOpenSetting.tsx');
    expect(f).toContain('setAutoOpenEnabled(userId');
    expect(f).toContain('if (!userId) return null');
    expect(f).not.toMatch(/fetch\(|api\/user\/profile/);
  });
  it('the opener only navigates — it never writes a rental, fuel reading or user mode', () => {
    const f = read('components/RentalAutoOpen.tsx');
    expect(f).toContain("fetch('/api/rental-sessions?status=active', { signal: abort.signal })");   // a read
    expect(f).not.toMatch(/method:\s*'(POST|PATCH|PUT|DELETE)'|userMode|gc:user-mode/);
    expect(read('app/layout.tsx')).toContain('<RentalAutoOpen />');
  });
  it('only fetches when it could actually open (enabled for THIS account, home route) — no network for everyone else', () => {
    const f = read('components/RentalAutoOpen.tsx');
    expect(f.indexOf('isAutoOpenEnabled(myUserId)')).toBeGreaterThan(-1);
    expect(f.indexOf('isAutoOpenEnabled(myUserId)')).toBeLessThan(f.indexOf('fetch('));
  });
  it('stale-check protection is wired: abort + generation on cleanup, re-verified right before navigating', () => {
    const f = read('components/RentalAutoOpen.tsx');
    expect(f).toContain('new AbortController()');
    expect(f).toContain('{ signal: abort.signal }');
    expect(f).toContain('abort.abort()');
    expect(f).toContain('generation.current += 1');
    expect(f).toMatch(/\[status, userId, pathname\]/);                       // logout / account change / navigation re-run the effect
    const gate = f.indexOf('canNavigateAfterCheck({');
    expect(gate).toBeGreaterThan(f.indexOf('decideAutoOpen('));
    expect(gate).toBeLessThan(f.indexOf('router.push('));
    expect(f.indexOf('setAutoOpenOnceFlag(')).toBeGreaterThan(gate);          // the once flag is only spent if it navigates
  });
  it('the multi-pickup banner text exists in EN and ES', () => {
    const t = read('lib/translations.ts');
    expect((t.match(/rentalModeAtPickupMultiple/g) ?? []).length).toBe(2);
  });
});
