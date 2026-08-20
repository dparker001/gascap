/**
 * lib/iap.ts — purchasePro() regression coverage for the iap_checkout_started
 * client analytics signal. Verifies it fires only once a real product package
 * has resolved and the native purchase sheet is genuinely about to be invoked
 * — never on a no-offerings/no-package failure, which isn't a real attempt.
 *
 * No native bridge / RevenueCat SDK is real here — the dynamic
 * `@revenuecat/purchases-capacitor` import is mocked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const detectNativePlatform = vi.fn<() => 'ios' | 'android' | null>(() => 'ios');
vi.mock('@/hooks/useIsNative', () => ({ detectNativePlatform: (...a: unknown[]) => detectNativePlatform(...(a as [])) }));

const trackClientEvent = vi.fn();
vi.mock('@/lib/clientAnalytics', () => ({ trackClientEvent: (...a: unknown[]) => trackClientEvent(...(a as [])) }));

const getOfferings   = vi.fn();
const purchasePackage = vi.fn();
vi.mock('@revenuecat/purchases-capacitor', () => ({
  Purchases: {
    configure:       vi.fn(),
    logIn:           vi.fn(),
    getOfferings:    (...a: unknown[]) => getOfferings(...(a as [])),
    purchasePackage: (...a: unknown[]) => purchasePackage(...(a as [])),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  detectNativePlatform.mockReturnValue('ios');
});

describe('purchasePro() — iap_checkout_started', () => {
  it('IAP-U1. fires with the requested billing once a real package resolves, before the purchase sheet is invoked', async () => {
    const { purchasePro } = await import('@/lib/iap');
    const pkg = { product: { identifier: 'gascap_pro_lifetime' } };
    getOfferings.mockResolvedValue({ current: { availablePackages: [pkg] } });
    purchasePackage.mockResolvedValue({ customerInfo: { entitlements: { active: { pro: {} } } } });

    await purchasePro('lifetime');

    expect(trackClientEvent).toHaveBeenCalledWith('iap_checkout_started', { billing: 'lifetime' });
    expect(trackClientEvent.mock.invocationCallOrder[0]).toBeLessThan(purchasePackage.mock.invocationCallOrder[0]);
  });

  it('IAP-U2. does NOT fire when no offerings are returned — not a real purchase attempt', async () => {
    const { purchasePro } = await import('@/lib/iap');
    getOfferings.mockResolvedValue({ current: { availablePackages: [] } });

    const res = await purchasePro('monthly');

    expect(res).toEqual({ ok: false, error: 'no-offerings' });
    expect(trackClientEvent).not.toHaveBeenCalled();
    expect(purchasePackage).not.toHaveBeenCalled();
  });

  it('IAP-U3. does NOT fire on web (no native platform) — purchasePro no-ops before any RevenueCat call', async () => {
    detectNativePlatform.mockReturnValue(null);
    const { purchasePro } = await import('@/lib/iap');

    const res = await purchasePro('monthly');

    expect(res).toEqual({ ok: false, error: 'not-native' });
    expect(trackClientEvent).not.toHaveBeenCalled();
    expect(getOfferings).not.toHaveBeenCalled();
  });
});
