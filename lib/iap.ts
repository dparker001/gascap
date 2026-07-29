'use client';

/**
 * iap.ts — In-App Purchase helper (iOS + Android native), via RevenueCat.
 *
 * The native apps load the live web app, so this runs in the WebView and calls
 * the RevenueCat Capacitor plugin over the bridge. On web every function is a
 * no-op, so it's safe to call unconditionally.
 *
 * Flow: initIap(userId) once the user is known → purchasePro('monthly'|'lifetime')
 * from the native Pro UI → StoreKit/Play Billing handles payment → RevenueCat
 * fires the /api/native/revenuecat webhook → the user's account is granted Pro.
 */

import { detectNativePlatform } from '@/hooks/useIsNative';

// RevenueCat PUBLIC SDK keys — public by design (shipped in the app bundle).
// Env vars win when set (key rotation without a code change); hardcoded fallbacks
// keep builds working before the env var is configured.
const IOS_KEY     = process.env.NEXT_PUBLIC_REVENUECAT_IOS_KEY     || 'appl_jRoKILykVultnvdDRVsQcNxummv';
const ANDROID_KEY = process.env.NEXT_PUBLIC_REVENUECAT_ANDROID_KEY || '';

const PRODUCT_IDS = {
  monthly:  'gascap_pro_monthly',
  lifetime: 'gascap_pro_lifetime',
} as const;

let configured = false;

/** Returns the native platform if IAP is available, or null on web. */
function nativePlatform(): 'ios' | 'android' | null {
  return detectNativePlatform();
}

/**
 * True if the account has ANY active RevenueCat entitlement. We don't hard-match
 * the entitlement identifier (RevenueCat's onboarding names it from the display
 * name, e.g. "GasCap Pro"), and GasCap has exactly one entitlement = Pro — so
 * "any active" is correct and robust to whatever identifier was assigned.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasActiveEntitlement(customerInfo: any): boolean {
  const active = customerInfo?.entitlements?.active;
  return !!active && Object.keys(active).length > 0;
}

/**
 * Lazy-load the plugin. Literal specifier so webpack bundles it into a lazy
 * chunk that ships with the live site — the iOS WebView (which loads remote
 * gascap.app) fetches it and bridges to the native RevenueCat StoreKit pod.
 * Same pattern as NativePushRegistration's @capacitor/push-notifications import.
 * The chunk only loads on iOS-gated paths, so web users never download it.
 */
async function loadPurchases(): Promise<{ Purchases: any } | null> {
  try {
    const mod = await import('@revenuecat/purchases-capacitor');
    return { Purchases: (mod as { Purchases: any }).Purchases };
  } catch {
    return null;   // bridge/plugin unavailable — no-op
  }
}

/** Configure RevenueCat and tie the entitlement to the GasCap account. */
export async function initIap(userId: string): Promise<void> {
  const platform = nativePlatform();
  const apiKey = platform === 'ios' ? IOS_KEY : platform === 'android' ? ANDROID_KEY : '';
  if (!platform || !apiKey || !userId) return;
  const rc = await loadPurchases();
  if (!rc) return;
  try {
    if (!configured) {
      await rc.Purchases.configure({ apiKey, appUserID: userId });
      configured = true;
    } else {
      await rc.Purchases.logIn({ appUserID: userId });
    }
  } catch (e) {
    console.error('[iap] configure failed:', e);
  }
}

/** Returns true if the signed-in account currently has the `pro` entitlement on-device. */
export async function hasProEntitlement(): Promise<boolean> {
  if (!nativePlatform()) return false;
  const rc = await loadPurchases();
  if (!rc) return false;
  try {
    const { customerInfo } = await rc.Purchases.getCustomerInfo();
    return hasActiveEntitlement(customerInfo);
  } catch {
    return false;
  }
}

export interface PurchaseResult { ok: boolean; cancelled?: boolean; error?: string }

/** Buy Pro via native IAP (Apple StoreKit or Google Play Billing). The webhook grants Pro server-side. */
export async function purchasePro(which: 'monthly' | 'lifetime'): Promise<PurchaseResult> {
  if (!nativePlatform()) return { ok: false, error: 'not-native' };
  const rc = await loadPurchases();
  if (!rc) return { ok: false, error: 'unavailable' };
  try {
    const offerings = await rc.Purchases.getOfferings();
    const productId = PRODUCT_IDS[which];
    const pkgs = offerings?.current?.availablePackages ?? [];
    // No packages means StoreKit returned no purchasable products — usually the
    // IAP products aren't approved/"Ready to Submit" yet, or the Paid Apps
    // Agreement just activated and hasn't propagated to sandbox.
    if (!pkgs.length) return { ok: false, error: 'no-offerings' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pkg = pkgs.find((p: any) => p?.product?.identifier === productId) ?? pkgs[0];
    if (!pkg) return { ok: false, error: 'no-package' };
    const { customerInfo } = await rc.Purchases.purchasePackage({ aPackage: pkg });
    return { ok: hasActiveEntitlement(customerInfo) };
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = e as any;
    if (err?.userCancelled || err?.code === 'PURCHASE_CANCELLED') return { ok: false, cancelled: true };
    console.error('[iap] purchase failed:', e);
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/** Restore previous purchases (required by Apple; useful on Android too). */
export async function restorePurchases(): Promise<PurchaseResult> {
  if (!nativePlatform()) return { ok: false, error: 'not-native' };
  const rc = await loadPurchases();
  if (!rc) return { ok: false, error: 'unavailable' };
  try {
    const { customerInfo } = await rc.Purchases.restorePurchases();
    return { ok: hasActiveEntitlement(customerInfo) };
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.error('[iap] restore failed:', e);
    return { ok: false, error: String((e as any)?.message ?? e) };
  }
}
