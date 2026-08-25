/**
 * lib/rentalSessions.ts — reminder dedup reset on reschedule (2026-08-25 P0
 * fix). Editing a rental's pickup/return time (or the timezone interpreting
 * it) must reset ONLY the affected dedup markers, so a rescheduled rental
 * gets a correctly-retimed reminder instead of silently losing it because
 * the OLD time already consumed the one-shot dedup. An edit that doesn't
 * touch date/time/timezone must never reset anything.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface Row {
  id: string; userId: string;
  pickupDateTime: string | null; returnDateTime: string | null; timeZone: string | null;
  pickupDateTimeUtc: string | null; returnDateTimeUtc: string | null;
  pickupFuelGallons: number | null; pickupFuelSource: string | null;
  currentFuelGallons: number | null; currentFuelSource: string | null;
  requiredReturnFuelGallons: number | null; requiredReturnPolicyType: string | null;
  fuelTankCapacityGallons: number | null;
  reminderSentAt: string | null; pickupReminder24SentAt: string | null;
  pickupReminder2SentAt: string | null; returnReminder2SentAt: string | null;
  refuelLogs: unknown[];
  [key: string]: unknown;
}

const table = new Map<string, Row>();

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'rs-1', userId: 'user-1',
    pickupDateTime: '2026-08-25T08:00', returnDateTime: '2026-08-25T10:00', timeZone: 'America/New_York',
    pickupDateTimeUtc: '2026-08-25T12:00:00.000Z', returnDateTimeUtc: '2026-08-25T14:00:00.000Z',
    pickupFuelGallons: 10, pickupFuelSource: 'MANUAL_GALLONS',
    currentFuelGallons: 10, currentFuelSource: 'MANUAL_GALLONS',
    requiredReturnFuelGallons: 10, requiredReturnPolicyType: 'same_as_pickup',
    fuelTankCapacityGallons: 14,
    reminderSentAt: '2026-08-24T12:00:00.000Z', pickupReminder24SentAt: '2026-08-24T00:00:00.000Z',
    pickupReminder2SentAt: '2026-08-25T06:00:00.000Z', returnReminder2SentAt: '2026-08-25T12:00:00.000Z',
    refuelLogs: [],
    ...overrides,
  };
}

const prismaMock = {
  rentalSession: {
    findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string } }) => {
      const row = table.get(where.id);
      return row && row.userId === where.userId ? row : null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const row = table.get(where.id)!;
      Object.assign(row, data);
      return row;
    }),
  },
};
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/analyticsEvents', () => ({ recordAnalyticsEvent: vi.fn(async () => ({ outcome: 'recorded' })) }));

beforeEach(() => {
  table.clear();
  vi.clearAllMocks();
});

async function getModule() {
  vi.resetModules();
  return import('@/lib/rentalSessions');
}

describe('updateRentalSession — reminder dedup reset', () => {
  it('4a. changing returnDateTime resets return-side dedup flags (reminderSentAt, returnReminder2SentAt) but NOT pickup-side flags', async () => {
    table.set('rs-1', makeRow());
    const { updateRentalSession } = await getModule();
    const result = await updateRentalSession('user-1', 'rs-1', { returnDateTime: '2026-08-25T14:00' });
    expect(result?.reminderSentAt).toBeNull();
    expect(result?.returnReminder2SentAt).toBeNull();
    expect(result?.pickupReminder24SentAt).not.toBeNull();
    expect(result?.pickupReminder2SentAt).not.toBeNull();
  });

  it('changing pickupDateTime resets pickup-side dedup flags but NOT return-side flags', async () => {
    table.set('rs-1', makeRow());
    const { updateRentalSession } = await getModule();
    const result = await updateRentalSession('user-1', 'rs-1', { pickupDateTime: '2026-08-25T09:00' });
    expect(result?.pickupReminder24SentAt).toBeNull();
    expect(result?.pickupReminder2SentAt).toBeNull();
    expect(result?.reminderSentAt).not.toBeNull();
    expect(result?.returnReminder2SentAt).not.toBeNull();
  });

  it('5. an UNCHANGED rental (resubmitting the same returnDateTime) does NOT reset any dedup flags', async () => {
    table.set('rs-1', makeRow());
    const { updateRentalSession } = await getModule();
    const result = await updateRentalSession('user-1', 'rs-1', { returnDateTime: '2026-08-25T10:00' }); // same value as existing
    expect(result?.reminderSentAt).not.toBeNull();
    expect(result?.returnReminder2SentAt).not.toBeNull();
    expect(result?.pickupReminder24SentAt).not.toBeNull();
    expect(result?.pickupReminder2SentAt).not.toBeNull();
  });

  it('an edit that never mentions date/time/timezone at all does not reset anything', async () => {
    table.set('rs-1', makeRow());
    const { updateRentalSession } = await getModule();
    const result = await updateRentalSession('user-1', 'rs-1', { notes: 'noted' });
    expect(result?.reminderSentAt).not.toBeNull();
    expect(result?.returnReminder2SentAt).not.toBeNull();
    expect(result?.pickupReminder24SentAt).not.toBeNull();
    expect(result?.pickupReminder2SentAt).not.toBeNull();
  });

  it('changing ONLY the timezone (same wall-clock strings) resets both pickup and return dedup flags, since the UTC instant changes', async () => {
    table.set('rs-1', makeRow());
    const { updateRentalSession } = await getModule();
    const result = await updateRentalSession('user-1', 'rs-1', { timeZone: 'America/Los_Angeles' });
    expect(result?.reminderSentAt).toBeNull();
    expect(result?.returnReminder2SentAt).toBeNull();
    expect(result?.pickupReminder24SentAt).toBeNull();
    expect(result?.pickupReminder2SentAt).toBeNull();
  });

  it('2. recomputes pickupDateTimeUtc/returnDateTimeUtc correctly when returnDateTime changes', async () => {
    table.set('rs-1', makeRow());
    const { updateRentalSession } = await getModule();
    const result = await updateRentalSession('user-1', 'rs-1', { returnDateTime: '2026-08-25T16:00' });
    expect(result?.returnDateTimeUtc).toBe('2026-08-25T20:00:00.000Z'); // 16:00 EDT -> 20:00 UTC
    expect(result?.pickupDateTimeUtc).toBe('2026-08-25T12:00:00.000Z'); // pickup untouched
  });
});
