/**
 * Growth Sprint 1, P0C-1A — regression coverage for fillup_logged (gig)
 * and rental_setup_completed, verifying the actual route/library write
 * paths.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Gig fillup route ────────────────────────────────────────────────────────

const getServerSession = vi.fn(async (..._a: unknown[]) => ({ user: { id: 'user-1', email: 'buyer@example.com' } }) as unknown);
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...(a as [])) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const gigTransaction = vi.fn(async (ops: unknown[]) => [{ id: 'gig_1', userId: 'user-1' }, {}]);
const rentalSessionCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({ ...args.data }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    gigFillup: { create: (args: unknown) => ({ __kind: 'gigFillup.create', args }) },
    user: { update: (args: unknown) => ({ __kind: 'user.update', args }) },
    $transaction: (ops: unknown[]) => gigTransaction(ops),
    rentalSession: { create: (args: { data: Record<string, unknown> }) => rentalSessionCreate(args) },
  },
}));

const recordAnalyticsEvent = vi.fn(async (..._a: unknown[]) => ({ outcome: 'written' as const, id: 'evt_1' }));
vi.mock('@/lib/analyticsEvents', () => ({
  recordAnalyticsEvent: (...a: unknown[]) => recordAnalyticsEvent(...(a as [])),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  getServerSession.mockResolvedValue({ user: { id: 'user-1', email: 'buyer@example.com' } });
  recordAnalyticsEvent.mockResolvedValue({ outcome: 'written', id: 'evt_1' });
  gigTransaction.mockImplementation(async () => [{ id: 'gig_1', userId: 'user-1' }, {}]);
});

async function postGigFillup(body: unknown) {
  const { POST } = await import('@/app/api/gig/fillups/route');
  const req = new Request('https://www.gascap.app/api/gig/fillups', {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return POST(req as never);
}

describe('fillup_logged (gig) — app/api/gig/fillups/route.ts', () => {
  it('F4/F5. successful gig transaction emits exactly one fillup_logged, after the transaction resolves', async () => {
    const res = await postGigFillup({ date: '2026-08-20', gallons: 10, pricePerGallon: 3.5 });
    expect(res.status).toBe(201);
    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(1);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call).toMatchObject({
      eventType: 'fillup_logged', emitter: 'server', originPlatform: 'unknown',
      userId: 'user-1', source: 'gig_fillup_create',
      idempotencyKey: 'fillup_logged:gig:gig_1',
    });
  });

  it('F6. failed gig transaction — no analytics event, no 201', async () => {
    gigTransaction.mockRejectedValueOnce(new Error('tx failed'));
    await expect(postGigFillup({ date: '2026-08-20', gallons: 10, pricePerGallon: 3.5 })).rejects.toThrow();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('F7. no gallons/price/station/odometer in gig analytics metadata', async () => {
    await postGigFillup({ date: '2026-08-20', gallons: 10, pricePerGallon: 3.5, station: 'Shell #123', odometer: 45000 });
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.metadata).toBeUndefined();
    const serialized = JSON.stringify(call);
    expect(serialized).not.toContain('Shell #123');
    expect(serialized).not.toContain('45000');
  });

  it('analytics failure does not change the existing successful 201 response', async () => {
    recordAnalyticsEvent.mockRejectedValueOnce(new Error('db unavailable'));
    const res = await postGigFillup({ date: '2026-08-20', gallons: 10, pricePerGallon: 3.5 });
    expect(res.status).toBe(201);
  });
});

// ── Rental session creation ─────────────────────────────────────────────────

describe('rental_setup_completed — lib/rentalSessions.ts createRentalSession()', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    recordAnalyticsEvent.mockResolvedValue({ outcome: 'written', id: 'evt_1' });
  });

  it('R1/R2. successful createRentalSession emits exactly one rental_setup_completed with the exact idempotency key', async () => {
    const { createRentalSession } = await import('@/lib/rentalSessions');
    const session = await createRentalSession('user-1', { rentalCompany: 'Hertz' } as never);
    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(1);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call).toMatchObject({
      eventType: 'rental_setup_completed', emitter: 'server', originPlatform: 'unknown',
      userId: 'user-1', source: 'rental_setup',
      idempotencyKey: `rental_setup_completed:${session.id}`,
    });
  });

  it('R3. analytics failure — RentalSession is still returned successfully', async () => {
    recordAnalyticsEvent.mockRejectedValueOnce(new Error('db unavailable'));
    const { createRentalSession } = await import('@/lib/rentalSessions');
    const session = await createRentalSession('user-1', { rentalCompany: 'Hertz' } as never);
    expect(session.rentalCompany).toBe('Hertz');
  });

  it('R4. no rental company/agreement/confirmation/address/vehicle details in analytics metadata', async () => {
    const { createRentalSession } = await import('@/lib/rentalSessions');
    await createRentalSession('user-1', {
      rentalCompany: 'Hertz', rentalAgreementNumber: 'AG-12345', returnLocation: '123 Main St',
    } as never);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.metadata).toBeUndefined();
    const serialized = JSON.stringify(call);
    expect(serialized).not.toContain('Hertz');
    expect(serialized).not.toContain('AG-12345');
    expect(serialized).not.toContain('123 Main St');
  });
});
