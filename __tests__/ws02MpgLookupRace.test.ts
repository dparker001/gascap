/**
 * WS02 PR #87 review finding 2 — a superseded MPG lookup must write nothing.
 *
 * These are BEHAVIORAL tests, not source assertions: each one actually defers
 * a lookup's resolution, makes a newer user choice while it is in flight,
 * then resolves the stale request and asserts nothing moved. A regex over the
 * component could not prove this.
 *
 * `legacyRun` reproduces the unguarded sequence the PR shipped with, so the
 * race is demonstrated before it is fixed.
 */
import { describe, it, expect } from 'vitest';
import { createLatestWinsGuard }           from '@/lib/latestWinsGuard';
import { createMpgLookup, type MpgLookupResponse, type MpgOptions } from '@/lib/mpgLookupController';

/** A promise whose resolution the test controls. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Stand-in for the component's MPG-related state. */
function makeState() {
  const s = {
    mpg: '', label: '', options: null as MpgOptions | null,
    lookingUp: false, unsupported: null as { energyType: string; detail: string } | null,
  };
  return {
    s,
    sinks: {
      setMpg:               (v: string) => { s.mpg = v; },
      setMpgSourceLabel:    (v: string) => { s.label = v; },
      setMpgOptions:        (v: MpgOptions | null) => { s.options = v; },
      setLookingUp:         (v: boolean) => { s.lookingUp = v; },
      setUnsupportedEnergy: (v: { energyType: string; detail: string } | null) => {
        s.unsupported = v as typeof s.unsupported;
      },
    },
  };
}

const OK = (comb: number): MpgLookupResponse => ({ ok: true, combMpg: comb, cityMpg: comb - 4, hwyMpg: comb + 7, energyType: 'gasoline' });

function harness(label = 'EPA') {
  const { s, sinks } = makeState();
  const pending: { query: string; d: ReturnType<typeof deferred<MpgLookupResponse>> }[] = [];
  const lookup = createMpgLookup({
    guard: createLatestWinsGuard(),
    fetchMpg: (query) => {
      const d = deferred<MpgLookupResponse>();
      pending.push({ query, d });
      return d.promise;
    },
    sinks,
    labelFor: () => label,
  });
  return { s, lookup, pending };
}

describe('the race being closed', () => {
  it('OLD behaviour: a stale lookup overwrites a newer manual MPG edit', async () => {
    const { s, sinks } = makeState();
    const d = deferred<MpgLookupResponse>();

    // Exactly what the shipped loadActiveRental did: no generation check.
    async function legacyRun() {
      sinks.setLookingUp(true);
      const data = await d.promise;
      if (data.ok && data.combMpg) {
        sinks.setMpg(String(data.combMpg));
        sinks.setMpgSourceLabel('EPA');
      }
      sinks.setLookingUp(false);
    }

    const inFlight = legacyRun();
    // User types their own MPG while the rental lookup is still pending.
    sinks.setMpg('19');
    sinks.setMpgSourceLabel('');
    d.resolve(OK(48));
    await inFlight;

    expect(s.mpg).toBe('48');          // the user's 19 was clobbered
    expect(s.label).toBe('EPA');
  });

  it('NEW behaviour: the same sequence leaves the manual edit alone', async () => {
    const { s, lookup, pending } = harness();

    const inFlight = lookup.run('year=2024&make=Toyota&model=Prius+Prime');
    // A manual edit issues no request, so it must cancel explicitly.
    lookup.invalidate();
    s.mpg = '19';
    s.label = '';

    pending[0].d.resolve(OK(48));
    await inFlight;

    expect(s.mpg).toBe('19');
    expect(s.label).toBe('');
    expect(s.options).toBeNull();
  });
});

describe('a superseded lookup writes nothing', () => {
  it('a newer lookup wins even when the older one resolves last', async () => {
    const { s, lookup, pending } = harness();

    const first  = lookup.run('year=2024&make=Toyota&model=Prius+Prime');  // rental
    const second = lookup.run('epaId=47085');                              // garage vehicle

    // The OLD one resolves after the new one was issued.
    pending[1].d.resolve(OK(26));
    await second;
    expect(s.mpg).toBe('26');

    pending[0].d.resolve(OK(48));
    await first;

    expect(s.mpg).toBe('26');          // still the newer answer
    expect(s.options).toEqual({ comb: 26, city: 22, hwy: 33 });
  });

  it('a stale response does not clear a NEWER lookup s spinner', async () => {
    const { s, lookup, pending } = harness();

    const first  = lookup.run('a');
    const second = lookup.run('b');    // still pending
    expect(s.lookingUp).toBe(true);

    pending[0].d.resolve(OK(48));      // stale one lands
    await first;

    // An ungated `finally` here would look like a silent failure: spinner off
    // while the real request is still running.
    expect(s.lookingUp).toBe(true);

    pending[1].d.resolve(OK(26));
    await second;
    expect(s.lookingUp).toBe(false);
    expect(s.mpg).toBe('26');
  });

  it('a stale REJECTION does not disturb newer state either', async () => {
    const { s, lookup, pending } = harness();
    const first  = lookup.run('a');
    const second = lookup.run('b');
    pending[1].d.resolve(OK(26));
    await second;

    pending[0].d.reject(new Error('network'));
    await first;

    expect(s.mpg).toBe('26');
    expect(s.lookingUp).toBe(false);
  });

  it('a stale unsupported-energy response does not raise a notice after a newer choice', async () => {
    const { s, lookup, pending } = harness();
    const first  = lookup.run('ev');
    lookup.invalidate();               // user picks a generic preset
    s.mpg = '24';

    pending[0].d.resolve({ ok: false, reason: 'unsupported_energy_type', energyType: 'electric', error: 'MPGe' });
    await first;

    expect(s.unsupported).toBeNull();
    expect(s.mpg).toBe('24');
  });
});

describe('invalidate() covers every choice that issues no request', () => {
  it.each([
    ['a generic rental preset selection'],
    ['a vehicle-mode switch'],
    ['a reset'],
    ['an account change or unmount'],
  ])('%s cancels an in-flight lookup', async () => {
    const { s, lookup, pending } = harness();
    const inFlight = lookup.run('pending');
    lookup.invalidate();
    expect(s.lookingUp).toBe(false);

    pending[0].d.resolve(OK(48));
    await inFlight;

    expect(s.mpg).toBe('');
    expect(s.label).toBe('');
    expect(s.options).toBeNull();
  });

  it('a lookup issued AFTER an invalidate still applies', async () => {
    const { s, lookup, pending } = harness();
    lookup.invalidate();
    const inFlight = lookup.run('fresh');
    pending[0].d.resolve(OK(31));
    await inFlight;
    expect(s.mpg).toBe('31');
  });
});

describe('a current lookup applies normally', () => {
  it('fills mpg, label and the city/hwy/comb options', async () => {
    const { s, lookup, pending } = harness('📋 EPA estimate · 2024 Toyota Camry');
    const inFlight = lookup.run('epaId=47085');
    expect(s.lookingUp).toBe(true);
    pending[0].d.resolve(OK(26));
    await inFlight;

    expect(s).toMatchObject({
      mpg: '26',
      label: '📋 EPA estimate · 2024 Toyota Camry',
      options: { comb: 26, city: 22, hwy: 33 },
      lookingUp: false,
      unsupported: null,
    });
  });

  it('a non-gallon vehicle raises the notice and sets no MPG', async () => {
    const { s, lookup, pending } = harness();
    const inFlight = lookup.run('epaId=46973');
    pending[0].d.resolve({ ok: false, reason: 'unsupported_energy_type', energyType: 'electric', error: 'MPGe, not MPG.' });
    await inFlight;

    expect(s.mpg).toBe('');
    expect(s.options).toBeNull();
    expect(s.unsupported).toEqual({ energyType: 'electric', detail: 'MPGe, not MPG.' });
  });

  it('an ordinary no-data failure raises no notice and sets no MPG', async () => {
    const { s, lookup, pending } = harness();
    const inFlight = lookup.run('epaId=1');
    pending[0].d.resolve({ ok: false, reason: 'no_epa_data', error: 'none' });
    await inFlight;
    expect(s.mpg).toBe('');
    expect(s.unsupported).toBeNull();
  });

  it('a zero or negative combMpg is never written', async () => {
    for (const comb of [0, -5]) {
      const { s, lookup, pending } = harness();
      const inFlight = lookup.run('q');
      pending[0].d.resolve({ ok: true, combMpg: comb });
      await inFlight;
      expect(s.mpg, String(comb)).toBe('');
    }
  });
});
