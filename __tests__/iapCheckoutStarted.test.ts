/**
 * lib/iap.ts — purchasePro() regression coverage for the iap_checkout_started
 * client analytics signal AND for Purchase Integrity exact-package selection.
 *
 * Verifies (1) the analytics event fires only once a real product package
 * has resolved and the native purchase sheet is genuinely about to be
 * invoked — never on a no-offerings/no-package failure, which isn't a real
 * attempt — and (2) purchasePro() resolves ONLY the exact requested product
 * ID, never falling back to whatever package happens to be first. A caller
 * requesting Lifetime with only a Monthly package available (or vice versa)
 * must get 'no-package', never a substitute purchase of the wrong plan.
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

  // ── Purchase Integrity — exact package selection, no fallback ───────────

  it('IAP-U4. requesting Lifetime when RevenueCat returns only Monthly → no-package, no purchasePackage, no analytics', async () => {
    const { purchasePro } = await import('@/lib/iap');
    const monthlyOnly = { product: { identifier: 'gascap_pro_monthly' } };
    getOfferings.mockResolvedValue({ current: { availablePackages: [monthlyOnly] } });

    const res = await purchasePro('lifetime');

    expect(res).toEqual({ ok: false, error: 'no-package' });
    expect(purchasePackage).not.toHaveBeenCalled();
    expect(trackClientEvent).not.toHaveBeenCalled();
  });

  it('IAP-U5. requesting Monthly when RevenueCat returns only Lifetime → no-package, no purchasePackage, no analytics', async () => {
    const { purchasePro } = await import('@/lib/iap');
    const lifetimeOnly = { product: { identifier: 'gascap_pro_lifetime' } };
    getOfferings.mockResolvedValue({ current: { availablePackages: [lifetimeOnly] } });

    const res = await purchasePro('monthly');

    expect(res).toEqual({ ok: false, error: 'no-package' });
    expect(purchasePackage).not.toHaveBeenCalled();
    expect(trackClientEvent).not.toHaveBeenCalled();
  });

  it('IAP-U6. exact Lifetime match — analytics fires with billing:"lifetime" and the correct Lifetime package is passed to purchasePackage()', async () => {
    const { purchasePro } = await import('@/lib/iap');
    const monthly  = { product: { identifier: 'gascap_pro_monthly' } };
    const lifetime = { product: { identifier: 'gascap_pro_lifetime' } };
    getOfferings.mockResolvedValue({ current: { availablePackages: [monthly, lifetime] } });
    purchasePackage.mockResolvedValue({ customerInfo: { entitlements: { active: { pro: {} } } } });

    const res = await purchasePro('lifetime');

    expect(res.ok).toBe(true);
    expect(trackClientEvent).toHaveBeenCalledWith('iap_checkout_started', { billing: 'lifetime' });
    expect(purchasePackage).toHaveBeenCalledWith({ aPackage: lifetime });
  });

  it('IAP-U7. exact Monthly match — analytics fires with billing:"monthly" and the correct Monthly package is passed to purchasePackage()', async () => {
    const { purchasePro } = await import('@/lib/iap');
    const monthly  = { product: { identifier: 'gascap_pro_monthly' } };
    const lifetime = { product: { identifier: 'gascap_pro_lifetime' } };
    getOfferings.mockResolvedValue({ current: { availablePackages: [monthly, lifetime] } });
    purchasePackage.mockResolvedValue({ customerInfo: { entitlements: { active: { pro: {} } } } });

    const res = await purchasePro('monthly');

    expect(res.ok).toBe(true);
    expect(trackClientEvent).toHaveBeenCalledWith('iap_checkout_started', { billing: 'monthly' });
    expect(purchasePackage).toHaveBeenCalledWith({ aPackage: monthly });
  });

  it('IAP-U8. an analytics failure never blocks or interferes with the purchase itself', async () => {
    trackClientEvent.mockImplementation(() => { throw new Error('analytics down'); });
    const { purchasePro } = await import('@/lib/iap');
    const lifetime = { product: { identifier: 'gascap_pro_lifetime' } };
    getOfferings.mockResolvedValue({ current: { availablePackages: [lifetime] } });
    purchasePackage.mockResolvedValue({ customerInfo: { entitlements: { active: { pro: {} } } } });

    const res = await purchasePro('lifetime');

    expect(res.ok).toBe(true);
    expect(purchasePackage).toHaveBeenCalledWith({ aPackage: lifetime });
  });
});
