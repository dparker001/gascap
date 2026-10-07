/**
 * Phase 0.5B — GET /api/fillups/savings: auth, scoping, and honest degradation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getServerSession = vi.fn();
const getFillups = vi.fn();
const loadNationalSnapshots = vi.fn();
vi.mock('next-auth', () => ({ getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/fillups', () => ({ getFillups }));
vi.mock('@/lib/fuelPriceSnapshots', () => ({ loadNationalSnapshots }));

const fillup = (over = {}) => ({
  id: 'f1', userId: 'u1', vehicleName: 'Civic', date: '2026-10-07', gallonsPumped: 10,
  pricePerGallon: 4.0, totalCost: 40, fuelGrade: 'regular', createdAt: '2026-10-07T00:00:00Z', ...over,
});
const NATIONAL = { regular: [{ observedOn: '2026-10-05', price: 4.354 }] };

const call = async () => { vi.resetModules(); const { GET } = await import('@/app/api/fillups/savings/route'); return GET(); };

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { id: 'u1', email: 'a@b.c' } });
  getFillups.mockResolvedValue([fillup()]);
  loadNationalSnapshots.mockResolvedValue(NATIONAL);
});

describe('GET /api/fillups/savings', () => {
  it('401 without a session, and reads nothing', async () => {
    getServerSession.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(getFillups).not.toHaveBeenCalled();
  });

  it('reads ONLY the signed-in user\'s own fill-ups', async () => {
    await call();
    expect(getFillups).toHaveBeenCalledWith('u1');
  });

  it('returns a time-matched, grade-matched comparison with the methodology facts', async () => {
    const body = await (await call()).json();
    expect(body.summary.compared).toBe(1);
    expect(body.summary.netSavings).toBe(3.54);          // 4.354*10 - 40
    expect(body.summary.perFillup[0]).toMatchObject({ status: 'compared', baselinePeriod: '2026-10-05', origin: 'snapshot' });
    expect(body.method).toEqual({ source: 'eia_weekly', maxBaselineAgeDays: 13 });
    expect(body.historyAvailable).toBe(true);
  });

  it('asks for history only back to the earliest fill-up (minus the match window)', async () => {
    getFillups.mockResolvedValue([fillup({ date: '2026-03-20' }), fillup({ id: 'f2', date: '2026-09-01' })]);
    await call();
    expect(loadNationalSnapshots).toHaveBeenCalledWith('2026-03-07'); // 13 days before 03-20
  });

  it('REGRESSION: no history -> NO savings figure (the old code fell back to $3.45)', async () => {
    loadNationalSnapshots.mockResolvedValue({});
    const body = await (await call()).json();
    expect(body.summary.compared).toBe(0);
    expect(body.summary.netSavings).toBe(0);
    expect(body.summary.excluded.no_baseline).toBe(1);
  });

  it('degrades honestly when the snapshot table is unavailable (e.g. not migrated yet)', async () => {
    loadNationalSnapshots.mockRejectedValue(new Error('relation does not exist'));
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.historyAvailable).toBe(false);
    expect(body.summary.compared).toBe(0);
  });

  it('a fill-up with a stored (log-time) baseline still compares when history is unavailable', async () => {
    loadNationalSnapshots.mockRejectedValue(new Error('down'));
    getFillups.mockResolvedValue([fillup({ baselinePrice: 4.2, baselineSource: 'eia_weekly', baselineArea: 'SFL', baselinePeriod: '2026-10-05' })]);
    const body = await (await call()).json();
    expect(body.summary.perFillup[0]).toMatchObject({ status: 'compared', origin: 'stored', baselineArea: 'SFL' });
  });

  it('no fill-ups: empty summary, no history query', async () => {
    getFillups.mockResolvedValue([]);
    const body = await (await call()).json();
    expect(body.summary.fillupsTotal).toBe(0);
    expect(loadNationalSnapshots).not.toHaveBeenCalled();
  });
});
