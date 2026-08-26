/**
 * Phase 3A completion hardening (2026-08-25) — lib/rentalSessions.ts's
 * completeRentalSession(). Fixes a pre-existing integrity gap: a repeated
 * "Complete Rental" request used to silently re-apply (and potentially
 * overwrite) dispute/feedback fields from a second submission. Now a
 * session already in status:'completed' is a safe no-op — the original
 * completion data is preserved, and completing never creates a Fillup
 * (completion and logging a final fuel transaction are related but
 * distinct actions).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface Row {
  id: string; userId: string; status: string; completedAt: string | null;
  returnGaugePhotoThumb: string | null; returnReceiptPhotoThumb: string | null;
  fuelFeeCharged: boolean | null; fuelFeeAmount: number | null;
  fuelFeeGallonsClaimed: number | null; fuelFeeRentalReportedLevel: number | null;
  disputeNotes: string | null; feedbackRating: number | null; feedbackText: string | null;
  updatedAt: string;
  [key: string]: unknown;
}

const table = new Map<string, Row>();

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'rs-1', userId: 'user-1', status: 'active', completedAt: null,
    returnGaugePhotoThumb: null, returnReceiptPhotoThumb: null,
    fuelFeeCharged: null, fuelFeeAmount: null, fuelFeeGallonsClaimed: null, fuelFeeRentalReportedLevel: null,
    disputeNotes: null, feedbackRating: null, feedbackText: null,
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const prismaMock = {
  rentalSession: {
    findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string } }) => {
      const row = table.get(where.id);
      return row && row.userId === where.userId ? { ...row } : null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const row = table.get(where.id)!;
      Object.assign(row, data);
      return { ...row };
    }),
    deleteMany: vi.fn(async () => ({ count: 0 })),
  },
  fillup: {
    create: vi.fn(async () => { throw new Error('completeRentalSession must never create a Fillup'); }),
  },
};
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const recordAnalyticsEvent = vi.fn(async (..._args: unknown[]) => ({ outcome: 'written' as const, id: 'evt_1' }));
vi.mock('@/lib/analyticsEvents', () => ({ recordAnalyticsEvent: (...a: unknown[]) => recordAnalyticsEvent(...(a as [])) }));

let completeRentalSession: typeof import('@/lib/rentalSessions').completeRentalSession;

beforeEach(async () => {
  vi.clearAllMocks();
  table.clear();
  table.set('rs-1', makeRow());
  const mod = await import('@/lib/rentalSessions');
  completeRentalSession = mod.completeRentalSession;
});

describe('completeRentalSession — idempotency hardening', () => {
  it('the first completion sets status to completed and records feedback/dispute fields', async () => {
    const result = await completeRentalSession('user-1', 'rs-1', { feedbackRating: 5, disputeNotes: 'none' });
    expect(result?.status).toBe('completed');
    expect(result?.feedbackRating).toBe(5);
    expect(result?.disputeNotes).toBe('none');
  });

  it('a repeated completion request is a safe no-op — original data is preserved, not overwritten', async () => {
    await completeRentalSession('user-1', 'rs-1', { feedbackRating: 5, disputeNotes: 'first submission' });
    const second = await completeRentalSession('user-1', 'rs-1', { feedbackRating: 1, disputeNotes: 'a different, later submission' });

    expect(second?.status).toBe('completed');
    expect(second?.feedbackRating).toBe(5); // NOT overwritten by the second call's feedbackRating: 1
    expect(second?.disputeNotes).toBe('first submission'); // NOT overwritten
  });

  it('a repeated completion never creates a Fillup row', async () => {
    await completeRentalSession('user-1', 'rs-1', { feedbackRating: 5 });
    await expect(completeRentalSession('user-1', 'rs-1', { feedbackRating: 2 })).resolves.toBeDefined();
    expect(prismaMock.fillup.create).not.toHaveBeenCalled();
  });

  it('fires rental_session_completed exactly once, not on the idempotent no-op retry', async () => {
    await completeRentalSession('user-1', 'rs-1', { feedbackRating: 5 });
    await completeRentalSession('user-1', 'rs-1', { feedbackRating: 5 });
    const completionCalls = recordAnalyticsEvent.mock.calls.filter(
      (c) => (c[0] as unknown as { eventType: string }).eventType === 'rental_session_completed',
    );
    expect(completionCalls).toHaveLength(1);
    expect(completionCalls[0]?.[0]).toMatchObject({ idempotencyKey: 'rental_session_completed:rs-1' });
  });

  it('returns undefined for an unknown or unauthorized session, same as before', async () => {
    expect(await completeRentalSession('user-1', 'nope', {})).toBeUndefined();
    expect(await completeRentalSession('someone-else', 'rs-1', {})).toBeUndefined();
  });
});
