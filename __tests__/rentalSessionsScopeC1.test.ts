/**
 * PR #62 final corrections — useRentalSessions is keyed to the authenticated
 * user: stale account data is cleared and an old request can never update
 * another account's state (account switch, logout).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  EMPTY_SCOPED, sessionsForUser, isLoadingFor, startRentalSessionsLoad, type ScopedSessions,
} from '@/lib/rentalSessionsScope';
import type { RentalSession } from '@/lib/rentalSessions';

const rs = (id: string) => ({ id, status: 'active' } as unknown as RentalSession);

/** A fetch whose responses the test releases by hand. */
function deferredFetch() {
  const calls: Array<{ url: string; signal: AbortSignal; resolve: (body: unknown, ok?: boolean) => void; reject: (e: unknown) => void }> = [];
  const fetchImpl = (url: string, init: { signal: AbortSignal }) => new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve, reject) => {
    calls.push({
      url, signal: init.signal, reject,
      resolve: (body, ok = true) => resolve({ ok, json: async () => body }),
    });
  });
  return { calls, fetchImpl };
}
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

/** Mirrors the hook's effect: on every (authenticated, userId) change, drop data, cancel the old load, start a new one. */
function makeHarness() {
  const d = deferredFetch();
  const h = { state: EMPTY_SCOPED as ScopedSessions, cancel: null as null | (() => void), applied: [] as ScopedSessions[] };
  function setAccount(userId: string | null) {
    h.cancel?.(); h.cancel = null;                       // effect cleanup
    h.state = EMPTY_SCOPED;                              // setScoped(EMPTY_SCOPED)
    if (userId) h.cancel = startRentalSessionsLoad(userId, d.fetchImpl, (next) => { h.state = next; h.applied.push(next); });
  }
  return { d, h, setAccount };
}

describe('sessionsForUser / isLoadingFor (render-time scoping)', () => {
  const stateA: ScopedSessions = { userId: 'A', sessions: [rs('a1')] };
  it('exposes data only to the account it was fetched for', () => {
    expect(sessionsForUser(stateA, 'A').map((s) => s.id)).toEqual(['a1']);
    expect(sessionsForUser(stateA, 'B')).toEqual([]);          // even for the first frame after switching to B
    expect(sessionsForUser(stateA, null)).toEqual([]);         // logged out
    expect(sessionsForUser(stateA, undefined)).toEqual([]);
    expect(sessionsForUser(EMPTY_SCOPED, 'A')).toEqual([]);
  });
  it('is loading only for an authenticated user whose data has not arrived', () => {
    expect(isLoadingFor(EMPTY_SCOPED, true, 'A')).toBe(true);
    expect(isLoadingFor(stateA, true, 'A')).toBe(false);
    expect(isLoadingFor(stateA, true, 'B')).toBe(true);        // switched account → B's data is pending
    expect(isLoadingFor(stateA, false, null)).toBe(false);     // logged out: not loading
    expect(isLoadingFor(EMPTY_SCOPED, true, null)).toBe(false);
  });
});

describe('startRentalSessionsLoad', () => {
  it('loads the user’s open rentals and tags them with that user', async () => {
    const d = deferredFetch(); let got: ScopedSessions | null = null;
    startRentalSessionsLoad('A', d.fetchImpl, (s) => { got = s; });
    expect(d.calls[0].url).toBe('/api/rental-sessions?status=active');
    d.calls[0].resolve({ sessions: [rs('a1')] });
    await tick();
    expect(got).toEqual({ userId: 'A', sessions: [rs('a1')] });
  });
  it('cancel() aborts the request and NO callback ever runs, even if the response arrives later', async () => {
    const d = deferredFetch(); let called = 0;
    const cancel = startRentalSessionsLoad('A', d.fetchImpl, () => { called += 1; });
    cancel();
    expect(d.calls[0].signal.aborted).toBe(true);
    d.calls[0].resolve({ sessions: [rs('late')] });
    await tick();
    expect(called).toBe(0);
  });
  it('a failed or non-OK response is "no rentals" for that user (as before), only while current', async () => {
    const d = deferredFetch(); const got: ScopedSessions[] = [];
    startRentalSessionsLoad('A', d.fetchImpl, (s) => got.push(s));
    startRentalSessionsLoad('B', d.fetchImpl, (s) => got.push(s));
    d.calls[0].resolve({}, false);
    d.calls[1].reject(new Error('network'));
    await tick();
    expect(got).toEqual([{ userId: 'A', sessions: [] }, { userId: 'B', sessions: [] }]);
  });
  it('a cancelled request that FAILS also stays silent', async () => {
    const d = deferredFetch(); let called = 0;
    const cancel = startRentalSessionsLoad('A', d.fetchImpl, () => { called += 1; });
    cancel();
    d.calls[0].reject(new DOMException('aborted', 'AbortError'));
    await tick();
    expect(called).toBe(0);
  });
});

describe('ACCOUNT SWITCH', () => {
  it('A’s slow response arriving AFTER B took over is discarded; B’s data stands', async () => {
    const { d, h, setAccount } = makeHarness();
    setAccount('A');                                            // A's request in flight
    setAccount('B');                                            // switch before it returns
    expect(d.calls[0].signal.aborted).toBe(true);
    d.calls[1].resolve({ sessions: [rs('b1')] });
    await tick();
    d.calls[0].resolve({ sessions: [rs('a-secret')] });         // A's late response
    await tick();
    expect(h.state).toEqual({ userId: 'B', sessions: [rs('b1')] });
    expect(sessionsForUser(h.state, 'B').map((s) => s.id)).toEqual(['b1']);
    expect(h.applied.map((s) => s.userId)).toEqual(['B']);       // A's result was never applied at all
  });
  it('A’s response arriving BEFORE B’s own is also discarded (it is no longer current)', async () => {
    const { d, h, setAccount } = makeHarness();
    setAccount('A'); setAccount('B');
    d.calls[0].resolve({ sessions: [rs('a-secret')] });
    await tick();
    expect(h.state).toEqual(EMPTY_SCOPED);                      // B's data not here yet, A's never shown
    expect(sessionsForUser(h.state, 'B')).toEqual([]);
    d.calls[1].resolve({ sessions: [rs('b1')] });
    await tick();
    expect(sessionsForUser(h.state, 'B').map((s) => s.id)).toEqual(['b1']);
  });
  it('after A loaded, switching to B drops A’s data immediately — before B’s response', async () => {
    const { d, h, setAccount } = makeHarness();
    setAccount('A'); d.calls[0].resolve({ sessions: [rs('a1')] }); await tick();
    expect(sessionsForUser(h.state, 'A').map((s) => s.id)).toEqual(['a1']);
    setAccount('B');
    expect(h.state).toEqual(EMPTY_SCOPED);
    expect(sessionsForUser(h.state, 'B')).toEqual([]);
    expect(isLoadingFor(h.state, true, 'B')).toBe(true);
  });
  it('even WITHOUT the effect having run yet, A’s data is not exposed to B (render-time guard)', () => {
    expect(sessionsForUser({ userId: 'A', sessions: [rs('a1')] }, 'B')).toEqual([]);
  });
  it('switching back to the same user restarts a fresh load (no stale cache is trusted)', async () => {
    const { d, h, setAccount } = makeHarness();
    setAccount('A'); d.calls[0].resolve({ sessions: [rs('a1')] }); await tick();
    setAccount('B'); setAccount('A');
    expect(h.state).toEqual(EMPTY_SCOPED);
    d.calls[2].resolve({ sessions: [rs('a2')] }); await tick();
    expect(sessionsForUser(h.state, 'A').map((s) => s.id)).toEqual(['a2']);
  });
});

describe('LOGOUT', () => {
  it('clears the data and exposes nothing', async () => {
    const { d, h, setAccount } = makeHarness();
    setAccount('A'); d.calls[0].resolve({ sessions: [rs('a1')] }); await tick();
    setAccount(null);
    expect(h.state).toEqual(EMPTY_SCOPED);
    expect(sessionsForUser(h.state, null)).toEqual([]);
    expect(isLoadingFor(h.state, false, null)).toBe(false);
  });
  it('a response that lands AFTER logout is ignored', async () => {
    const { d, h, setAccount } = makeHarness();
    setAccount('A');
    setAccount(null);
    expect(d.calls[0].signal.aborted).toBe(true);
    d.calls[0].resolve({ sessions: [rs('a-secret')] });
    await tick();
    expect(h.state).toEqual(EMPTY_SCOPED);
    expect(h.applied).toEqual([]);
  });
  it('logout then a different login: only the new account’s data ever appears', async () => {
    const { d, h, setAccount } = makeHarness();
    setAccount('A'); d.calls[0].resolve({ sessions: [rs('a1')] }); await tick();
    setAccount(null); setAccount('B');
    d.calls[1].resolve({ sessions: [rs('b1')] }); await tick();
    expect(h.state.userId).toBe('B');
    expect(h.state.sessions.map((s) => s.id)).toEqual(['b1']);
  });
});

describe('hook wiring (source guards)', () => {
  const src = readFileSync(path.join(process.cwd(), 'hooks/useRentalSessions.ts'), 'utf8');
  it('is keyed to the authenticated user id and restarts on account change', () => {
    expect(src).toContain("const authUserId = (authSession?.user as { id?: string } | undefined)?.id ?? null;");
    expect(src).toMatch(/\}, \[authenticated, authUserId\]\);/);
    expect(src).not.toMatch(/\}, \[status\]\);/);                          // the old status-only key
  });
  it('loads through the cancellable scoped loader and never fetches directly', () => {
    expect(src).toContain('startRentalSessionsLoad(authUserId');
    expect(src).not.toMatch(/\bfetch\('\/api\/rental-sessions/);
    expect(src).toContain('return startRentalSessionsLoad(');              // the effect returns the cancel function
  });
  it('clears stale data on logout/switch and exposes data only to its own account', () => {
    expect(src).toContain('setScoped(EMPTY_SCOPED);');
    expect(src).toContain('sessionsForUser(scoped, authenticated ? authUserId : null)');
    expect(src).toContain('isLoadingFor(scoped, authenticated, authUserId)');
  });
  it('the fallback re-sync only runs for a still-current, same-account result', () => {
    expect(src).toMatch(/syncRentalFallbacksFromSessions\(authUserId, next\.sessions\)/);
    expect(src.indexOf('startRentalSessionsLoad(authUserId')).toBeLessThan(src.indexOf('syncRentalFallbacksFromSessions(authUserId'));
  });
});
