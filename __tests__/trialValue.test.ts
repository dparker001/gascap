/**
 * TC-2A (2026-09-01) — lib/trialValue.ts regression coverage.
 *
 * Proves: queries are scoped to the exact passed-in userId (never a
 * caller-supplied override); vehicle/fillup/rentalSession counts are each
 * scoped by userId; calculations comes from User.calcCount (verified
 * reliable — see lib/trialValue.ts file header); no raw row data is
 * returned; zero-count inputs return 0 (not null) for the three
 * always-computed counts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const findUnique      = vi.fn(async (..._a: unknown[]) => ({ calcCount: 0 } as { calcCount: number } | null));
const vehicleCount     = vi.fn(async (..._a: unknown[]) => 0);
const fillupCount      = vi.fn(async (..._a: unknown[]) => 0);
const rentalSessionCount = vi.fn(async (..._a: unknown[]) => 0);

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user:           { findUnique: (...a: unknown[]) => findUnique(...(a as [])) },
    vehicle:        { count:      (...a: unknown[]) => vehicleCount(...(a as [])) },
    fillup:         { count:      (...a: unknown[]) => fillupCount(...(a as [])) },
    rentalSession:  { count:      (...a: unknown[]) => rentalSessionCount(...(a as [])) },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  findUnique.mockResolvedValue({ calcCount: 0 });
  vehicleCount.mockResolvedValue(0);
  fillupCount.mockResolvedValue(0);
  rentalSessionCount.mockResolvedValue(0);
});

describe('getTrialValueSummary', () => {
  it('scopes every query to the exact passed-in userId', async () => {
    const { getTrialValueSummary } = await import('@/lib/trialValue');
    await getTrialValueSummary('user-123');
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'user-123' }, select: { calcCount: true, budgetCalcCount: true } });
    expect(vehicleCount).toHaveBeenCalledWith({ where: { userId: 'user-123' } });
    expect(fillupCount).toHaveBeenCalledWith({ where: { userId: 'user-123' } });
    expect(rentalSessionCount).toHaveBeenCalledWith({ where: { userId: 'user-123' } });
  });

  it('does not accept or forward any caller-supplied filtering beyond userId', async () => {
    const { getTrialValueSummary } = await import('@/lib/trialValue');
    // getTrialValueSummary's signature only accepts a single userId string —
    // there is no way to pass extra filters through it. Confirm the call
    // shape it produces contains no other identifying field.
    await getTrialValueSummary('user-abc');
    const vehicleArgs = vehicleCount.mock.calls[0]?.[0] as unknown as { where: Record<string, unknown> };
    expect(Object.keys(vehicleArgs.where)).toEqual(['userId']);
  });

  it('returns 0 (not null) for vehicles/fillups/rentalSessions when the user has none', async () => {
    const { getTrialValueSummary } = await import('@/lib/trialValue');
    const result = await getTrialValueSummary('user-123');
    expect(result.vehicles).toBe(0);
    expect(result.fillups).toBe(0);
    expect(result.rentalSessions).toBe(0);
  });

  it('calculations reflects User.calcCount (verified reliable — single increment site, auth-gated, explicit-action-gated)', async () => {
    findUnique.mockResolvedValue({ calcCount: 7 });
    const { getTrialValueSummary } = await import('@/lib/trialValue');
    const result = await getTrialValueSummary('user-123');
    expect(result.calculations).toBe(7);
  });

  it('calculations is 0, not null, when calcCount is 0', async () => {
    findUnique.mockResolvedValue({ calcCount: 0 });
    const { getTrialValueSummary } = await import('@/lib/trialValue');
    const result = await getTrialValueSummary('user-123');
    expect(result.calculations).toBe(0);
  });

  it('returns only the four aggregate numbers — no raw rows, no nested data', async () => {
    vehicleCount.mockResolvedValue(3);
    fillupCount.mockResolvedValue(5);
    rentalSessionCount.mockResolvedValue(1);
    findUnique.mockResolvedValue({ calcCount: 4 });
    const { getTrialValueSummary } = await import('@/lib/trialValue');
    const result = await getTrialValueSummary('user-123');
    expect(Object.keys(result).sort()).toEqual(['calculations', 'fillups', 'rentalSessions', 'vehicles']);
    expect(result).toEqual({ calculations: 4, vehicles: 3, fillups: 5, rentalSessions: 1 });
  });
});

describe('hasTrialValue / trialValuePhrases', () => {
  it('hasTrialValue is false when everything is zero', async () => {
    const { hasTrialValue } = await import('@/lib/trialValue');
    expect(hasTrialValue({ calculations: 0, vehicles: 0, fillups: 0, rentalSessions: 0 })).toBe(false);
  });

  it('hasTrialValue is true when any one metric is non-zero', async () => {
    const { hasTrialValue } = await import('@/lib/trialValue');
    expect(hasTrialValue({ calculations: null, vehicles: 1, fillups: 0, rentalSessions: 0 })).toBe(true);
  });

  it('trialValuePhrases omits zero-value metrics and never renders "0 X"', async () => {
    const { trialValuePhrases } = await import('@/lib/trialValue');
    const phrases = trialValuePhrases({ calculations: 0, vehicles: 2, fillups: 0, rentalSessions: 0 });
    expect(phrases).toEqual(['2 vehicles saved']);
    expect(phrases.join(' ')).not.toMatch(/\b0\b/);
  });

  it('trialValuePhrases uses correct singular/plural grammar', async () => {
    const { trialValuePhrases } = await import('@/lib/trialValue');
    expect(trialValuePhrases({ calculations: 1, vehicles: 1, fillups: 1, rentalSessions: 1 })).toEqual([
      '1 GasCap calculation', '1 vehicle saved', '1 fill-up logged', '1 rental tracked',
    ]);
    expect(trialValuePhrases({ calculations: 2, vehicles: 2, fillups: 2, rentalSessions: 2 })).toEqual([
      '2 GasCap calculations', '2 vehicles saved', '2 fill-ups logged', '2 rentals tracked',
    ]);
  });

  it('trialValuePhrases omits calculations when null (unreliable/unverified)', async () => {
    const { trialValuePhrases } = await import('@/lib/trialValue');
    const phrases = trialValuePhrases({ calculations: null, vehicles: 3, fillups: 0, rentalSessions: 0 });
    expect(phrases).toEqual(['3 vehicles saved']);
  });
});
