/**
 * Phase 0.5B — /api/cron/fuel-price-snapshot auth + failure semantics.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

const syncFuelPriceSnapshots = vi.fn();
vi.mock('@/lib/fuelPriceSnapshots', () => ({ MAX_BACKFILL_WEEKS: 156, syncFuelPriceSnapshots }));

const ORIGINAL = process.env.CRON_SECRET;
const OK = { fetched: 8, inserted: 8, latestObservedOn: '2026-10-05', ageDays: 2, stale: false };
const call = async (qs: string) => {
  vi.resetModules();
  const { GET } = await import('@/app/api/cron/fuel-price-snapshot/route');
  return GET(new Request(`https://x.test/api/cron/fuel-price-snapshot${qs}`));
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'cron-secret-for-tests';
  syncFuelPriceSnapshots.mockResolvedValue(OK);
});
afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = ORIGINAL;
});

describe('auth fails closed', () => {
  it('503 (our misconfiguration) when CRON_SECRET is unset — never trusts the caller', async () => {
    delete process.env.CRON_SECRET;
    const res = await call('?secret=anything');
    expect(res.status).toBe(503);
    expect(syncFuelPriceSnapshots).not.toHaveBeenCalled();
  });
  it('503 also when unset and the caller sends NO secret (the `if (secret && …)` bug shape)', async () => {
    delete process.env.CRON_SECRET;
    const res = await call('');
    expect(res.status).toBe(503);
    expect(syncFuelPriceSnapshots).not.toHaveBeenCalled();
  });
  it('401 for a missing or wrong secret', async () => {
    expect((await call('')).status).toBe(401);
    expect((await call('?secret=wrong')).status).toBe(401);
    expect((await call('?secret=cron-secret-for-tests-x')).status).toBe(401); // length mismatch
    expect(syncFuelPriceSnapshots).not.toHaveBeenCalled();
  });
  it('never echoes the secret in any response body', async () => {
    for (const qs of ['', '?secret=wrong']) {
      expect(await (await call(qs)).text()).not.toContain('cron-secret-for-tests');
    }
  });
});

describe('run semantics', () => {
  it('defaults to a 3-week window and reports the result', async () => {
    const res = await call('?secret=cron-secret-for-tests');
    expect(res.status).toBe(200);
    expect(syncFuelPriceSnapshots).toHaveBeenCalledWith({ weeks: 3 });
    expect(await res.json()).toMatchObject({ ok: true, inserted: 8, latestObservedOn: '2026-10-05' });
  });
  it('?weeks= enables the one-time backfill, clamped to the cap', async () => {
    await call('?secret=cron-secret-for-tests&weeks=156');
    expect(syncFuelPriceSnapshots).toHaveBeenLastCalledWith({ weeks: 156 });
    await call('?secret=cron-secret-for-tests&weeks=99999');
    expect(syncFuelPriceSnapshots).toHaveBeenLastCalledWith({ weeks: 156 });
    await call('?secret=cron-secret-for-tests&weeks=0');
    expect(syncFuelPriceSnapshots).toHaveBeenLastCalledWith({ weeks: 1 });
    await call('?secret=cron-secret-for-tests&weeks=abc');
    expect(syncFuelPriceSnapshots).toHaveBeenLastCalledWith({ weeks: 3 });
  });
  it('502 (red GitHub run) when EIA itself is stale — not expected state', async () => {
    syncFuelPriceSnapshots.mockResolvedValue({ ...OK, ageDays: 23, stale: true });
    const res = await call('?secret=cron-secret-for-tests');
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, error: 'EIA data is stale' });
  });
  it('502 when the sync throws, without leaking the error detail', async () => {
    syncFuelPriceSnapshots.mockRejectedValue(new Error('EIA responded 500 api_key=SHOULD-NOT-LEAK'));
    const res = await call('?secret=cron-secret-for-tests');
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('SHOULD-NOT-LEAK');
  });
  it('and redacts any api_key from the server log line', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    syncFuelPriceSnapshots.mockRejectedValue(new Error('GET https://api.eia.gov/x?api_key=SHOULD-NOT-LEAK&frequency=weekly failed'));
    await call('?secret=cron-secret-for-tests');
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('SHOULD-NOT-LEAK');
    expect(logged).toContain('api_key=REDACTED');
    spy.mockRestore();
  });
});
