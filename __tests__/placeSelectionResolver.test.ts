/**
 * Routing-integrity fix (2026-10-12) — deterministic async-ordering tests for
 * resolveSelectedPlace()/invalidateSelection(), the staleness-guarded wrapper
 * that replaced TripCostEstimator's unguarded selectOriginSuggestion/
 * selectDestSuggestion.
 *
 * Every scenario below uses a manually-resolvable ("deferred") promise in
 * place of the real /api/maps/place-location fetch, so completion order is
 * fully controlled rather than left to real async timing — the exact
 * ordering bugs this fix addresses only show up when a LATER selection's
 * lookup finishes BEFORE an EARLIER selection's lookup, which real-network
 * timing can't reliably reproduce in a test run.
 *
 * ChatGPT review (2026-10-12, PR #84) required a correction to the original
 * version: the loading state must reflect whether the CURRENT generation's
 * lookup is still outstanding, not a count of all historical requests —
 * scenarios 11-14 below were added for that correction, including a
 * deliberately never-resolving obsolete request (scenario 13).
 */
import { describe, it, expect } from 'vitest';
import { createLatestWinsGuard } from '@/lib/latestWinsGuard';
import { resolveSelectedPlace, invalidateSelection } from '@/lib/placeSelectionResolver';

type Coords = { latitude: number; longitude: number };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function resolvingTracker() {
  const history: boolean[] = [];
  return {
    history,
    set: (r: boolean) => history.push(r),
    current: () => history.length === 0 ? false : history[history.length - 1],
  };
}

describe('resolveSelectedPlace — staleness-guarded place resolution', () => {
  it('1. A/B selection race: selecting B before A resolves, then A resolving late, applies only B\'s coords', async () => {
    const guard = createLatestWinsGuard();
    const applied: Coords[] = [];
    const resolving = resolvingTracker();
    const a = deferred<Coords | null>();
    const b = deferred<Coords | null>();

    const pA = resolveSelectedPlace(guard, () => a.promise, (c) => applied.push(c), resolving.set);
    const pB = resolveSelectedPlace(guard, () => b.promise, (c) => applied.push(c), resolving.set);

    // B's lookup finishes first (plausible — A's request may be slower),
    // then A's late lookup finishes after.
    b.resolve({ latitude: 2, longitude: 2 });
    a.resolve({ latitude: 1, longitude: 1 });
    await Promise.all([pA, pB]);

    expect(applied).toEqual([{ latitude: 2, longitude: 2 }]);
  });

  it('2. Reverse completion order: the LATER selection still wins even if its lookup resolves BEFORE the earlier one\'s', async () => {
    const guard = createLatestWinsGuard();
    const applied: Coords[] = [];
    const resolving = resolvingTracker();
    const a = deferred<Coords | null>();
    const b = deferred<Coords | null>();

    const pA = resolveSelectedPlace(guard, () => a.promise, (c) => applied.push(c), resolving.set);
    const pB = resolveSelectedPlace(guard, () => b.promise, (c) => applied.push(c), resolving.set);

    // B (the later selection) resolves first in wall-clock time.
    b.resolve({ latitude: 20, longitude: 20 });
    await pB;
    // A's stale lookup resolves afterward — must be discarded.
    a.resolve({ latitude: 10, longitude: 10 });
    await pA;

    expect(applied).toEqual([{ latitude: 20, longitude: 20 }]);
  });

  it('3. A failed/null lookup never calls apply — nothing to "restore" on failure', async () => {
    const guard = createLatestWinsGuard();
    const applied: Coords[] = [];
    const resolving = resolvingTracker();
    await resolveSelectedPlace(guard, async () => null, (c) => applied.push(c), resolving.set);
    expect(applied).toEqual([]);
    expect(resolving.current()).toBe(false);
  });

  it('4. Manual text edit after selection invalidates the pending lookup (via invalidateSelection)', async () => {
    const guard = createLatestWinsGuard();
    const applied: Coords[] = [];
    const resolving = resolvingTracker();
    const pending = deferred<Coords | null>();

    const p = resolveSelectedPlace(guard, () => pending.promise, (c) => applied.push(c), resolving.set);
    invalidateSelection(guard, resolving.set); // what the onChange handler does on a manual keystroke
    pending.resolve({ latitude: 1, longitude: 1 });
    await p;

    expect(applied).toEqual([]);
  });

  it('5. Clearing the field after selection invalidates the pending lookup', async () => {
    const guard = createLatestWinsGuard();
    const applied: Coords[] = [];
    const resolving = resolvingTracker();
    const pending = deferred<Coords | null>();

    const p = resolveSelectedPlace(guard, () => pending.promise, (c) => applied.push(c), resolving.set);
    invalidateSelection(guard, resolving.set); // what the clear-X handler does
    pending.resolve({ latitude: 1, longitude: 1 });
    await p;

    expect(applied).toEqual([]);
  });

  it('6. Switching to Current Location or a saved favorite after selection invalidates the pending lookup', async () => {
    const guard = createLatestWinsGuard();
    const applied: Coords[] = [];
    const resolving = resolvingTracker();
    const pending = deferred<Coords | null>();

    const p = resolveSelectedPlace(guard, () => pending.promise, (c) => applied.push(c), resolving.set);
    invalidateSelection(guard, resolving.set); // what handleUseCurrentLocation/handleSelectOriginFavorite/etc. do
    pending.resolve({ latitude: 9, longitude: 9 });
    await p;

    expect(applied).toEqual([]);
  });

  it('7. Origin and destination guards are fully independent — invalidating one never affects the other', async () => {
    const originGuard = createLatestWinsGuard();
    const destGuard = createLatestWinsGuard();
    const originApplied: Coords[] = [];
    const destApplied: Coords[] = [];
    const originResolving = resolvingTracker();
    const destResolving = resolvingTracker();
    const originPending = deferred<Coords | null>();
    const destPending = deferred<Coords | null>();

    const pOrigin = resolveSelectedPlace(originGuard, () => originPending.promise, (c) => originApplied.push(c), originResolving.set);
    const pDest = resolveSelectedPlace(destGuard, () => destPending.promise, (c) => destApplied.push(c), destResolving.set);

    // A dest-side mode switch must not invalidate the origin's in-flight lookup.
    invalidateSelection(destGuard, destResolving.set);
    originPending.resolve({ latitude: 5, longitude: 5 });
    destPending.resolve({ latitude: 6, longitude: 6 });
    await Promise.all([pOrigin, pDest]);

    expect(originApplied).toEqual([{ latitude: 5, longitude: 5 }]);
    expect(destApplied).toEqual([]);
    expect(originResolving.current()).toBe(false);
    expect(destResolving.current()).toBe(false);
  });

  it('8. A failed lookup followed by a later valid selection: the later selection still applies correctly', async () => {
    const guard = createLatestWinsGuard();
    const applied: Coords[] = [];
    const resolving = resolvingTracker();
    const failing = deferred<Coords | null>();
    const succeeding = deferred<Coords | null>();

    const pFail = resolveSelectedPlace(guard, () => failing.promise, (c) => applied.push(c), resolving.set);
    const pOk = resolveSelectedPlace(guard, () => succeeding.promise, (c) => applied.push(c), resolving.set);

    failing.reject(new Error('network error'));
    succeeding.resolve({ latitude: 7, longitude: 7 });
    await Promise.all([pFail, pOk]);

    expect(applied).toEqual([{ latitude: 7, longitude: 7 }]);
  });

  it('9. Three rapid selections settling out of order: only the last-started selection\'s coords are ever applied', async () => {
    const guard = createLatestWinsGuard();
    const applied: Coords[] = [];
    const resolving = resolvingTracker();
    const first = deferred<Coords | null>();
    const second = deferred<Coords | null>();
    const third = deferred<Coords | null>();

    const p1 = resolveSelectedPlace(guard, () => first.promise, (c) => applied.push(c), resolving.set);
    const p2 = resolveSelectedPlace(guard, () => second.promise, (c) => applied.push(c), resolving.set);
    const p3 = resolveSelectedPlace(guard, () => third.promise, (c) => applied.push(c), resolving.set);

    // Settle in a scrambled order: second, then first, then third.
    second.resolve({ latitude: 2, longitude: 2 });
    first.resolve({ latitude: 1, longitude: 1 });
    third.resolve({ latitude: 3, longitude: 3 });
    await Promise.all([p1, p2, p3]);

    expect(applied).toEqual([{ latitude: 3, longitude: 3 }]);
  });

  it('10. Re-selecting the SAME place twice still invalidates the first lookup (not deduped by placeId or by resolved value)', async () => {
    const guard = createLatestWinsGuard();
    const applyCount = { total: 0 };
    const resolving = resolvingTracker();
    const firstLookup = deferred<Coords | null>();
    const secondLookup = deferred<Coords | null>();
    const fetchCalls: Array<'first' | 'second'> = [];

    const p1 = resolveSelectedPlace(
      guard,
      () => { fetchCalls.push('first'); return firstLookup.promise; },
      () => { applyCount.total += 1; },
      resolving.set,
    );
    const p2 = resolveSelectedPlace(
      guard,
      () => { fetchCalls.push('second'); return secondLookup.promise; },
      () => { applyCount.total += 1; },
      resolving.set,
    );

    // Both lookups resolve to the identical coordinate value — if
    // invalidation were (incorrectly) keyed on comparing the resolved
    // value rather than on the generation token, this would be
    // indistinguishable from a single apply. It isn't: exactly one apply
    // fires because the second begin() invalidated the first's token
    // before either lookup settled.
    firstLookup.resolve({ latitude: 1, longitude: 1 });
    secondLookup.resolve({ latitude: 1, longitude: 1 });
    await Promise.all([p1, p2]);

    expect(fetchCalls).toEqual(['first', 'second']);
    expect(applyCount.total).toBe(1);
  });

  it('11. Selecting A then B: Calculate (resolving) becomes available as soon as B resolves, even though A is still outstanding', async () => {
    const guard = createLatestWinsGuard();
    const resolving = resolvingTracker();
    const a = deferred<Coords | null>();
    const b = deferred<Coords | null>();

    const pA = resolveSelectedPlace(guard, () => a.promise, () => {}, resolving.set);
    const pB = resolveSelectedPlace(guard, () => b.promise, () => {}, resolving.set);

    // Neither has resolved yet — still loading.
    expect(resolving.current()).toBe(true);

    // B (the current selection) resolves — loading must clear NOW, with A
    // still pending. This is the exact bug ChatGPT's review caught: a naive
    // in-flight counter would keep this true until A also settles.
    b.resolve({ latitude: 2, longitude: 2 });
    await pB;
    expect(resolving.current()).toBe(false);

    // A finally resolves afterward — must not flip loading back on.
    a.resolve({ latitude: 1, longitude: 1 });
    await pA;
    expect(resolving.current()).toBe(false);
  });

  it('12. A obsolete request resolving after B must not alter B\'s already-applied coordinates or the loading state', async () => {
    const guard = createLatestWinsGuard();
    const applied: Coords[] = [];
    const resolving = resolvingTracker();
    const a = deferred<Coords | null>();
    const b = deferred<Coords | null>();

    const pA = resolveSelectedPlace(guard, () => a.promise, (c) => applied.push(c), resolving.set);
    const pB = resolveSelectedPlace(guard, () => b.promise, (c) => applied.push(c), resolving.set);

    b.resolve({ latitude: 2, longitude: 2 });
    await pB;
    expect(applied).toEqual([{ latitude: 2, longitude: 2 }]);
    expect(resolving.current()).toBe(false);

    a.resolve({ latitude: 1, longitude: 1 });
    await pA;
    expect(applied).toEqual([{ latitude: 2, longitude: 2 }]); // unchanged
    expect(resolving.current()).toBe(false); // unchanged
  });

  it('13. A deliberately never-resolving obsolete request must not strand the loading state once a later selection resolves', async () => {
    const guard = createLatestWinsGuard();
    const resolving = resolvingTracker();
    const neverResolves = new Promise<Coords | null>(() => {}); // intentionally never settles
    const b = deferred<Coords | null>();

    // Fire-and-forget: pA is never awaited because it never settles.
    void resolveSelectedPlace(guard, () => neverResolves, () => {}, resolving.set);
    const pB = resolveSelectedPlace(guard, () => b.promise, () => {}, resolving.set);

    expect(resolving.current()).toBe(true);
    b.resolve({ latitude: 3, longitude: 3 });
    await pB;

    // B settling must clear loading even though the first request will
    // never resolve — a naive "wait for all outstanding" counter would
    // leave Calculate disabled forever in this case.
    expect(resolving.current()).toBe(false);
  });

  it('14. invalidateSelection() retires the loading state immediately, without waiting on the abandoned request at all', async () => {
    const guard = createLatestWinsGuard();
    const resolving = resolvingTracker();
    const neverResolves = new Promise<Coords | null>(() => {});

    void resolveSelectedPlace(guard, () => neverResolves, () => {}, resolving.set);
    expect(resolving.current()).toBe(true);

    // Manual edit / clear / mode switch — must flip loading off synchronously,
    // not after any microtask queue flush tied to the abandoned promise.
    invalidateSelection(guard, resolving.set);
    expect(resolving.current()).toBe(false);
  });
});
