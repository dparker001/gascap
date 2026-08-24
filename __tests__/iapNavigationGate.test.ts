import { describe, it, expect } from 'vitest';
import { shouldAllowIapSuccess } from '@/lib/iapNavigationGate';

describe('shouldAllowIapSuccess — server-authoritative IAP success gate', () => {
  it('1. CRITICAL — native RevenueCat Lifetime: pro=true, permanent=false, effectiveInterval=lifetime → allow', () => {
    // Genuine RC-only Lifetime resolves permanent=false by design (see
    // lib/entitlements.ts — `permanent` is reserved for stripeInterval/
    // ambassador). Gating on `permanent` here would block every legitimate
    // native Lifetime purchaser.
    expect(shouldAllowIapSuccess('lifetime', { pro: true, permanent: false, effectiveInterval: 'lifetime' })).toBe(true);
  });

  it('2. requested Lifetime + effectiveInterval=monthly → deny', () => {
    expect(shouldAllowIapSuccess('lifetime', { pro: true, permanent: false, effectiveInterval: 'monthly' })).toBe(false);
  });

  it('3. requested Monthly + effectiveInterval=monthly → allow', () => {
    expect(shouldAllowIapSuccess('monthly', { pro: true, permanent: false, effectiveInterval: 'monthly' })).toBe(true);
  });

  it('4. requested Monthly + effectiveInterval=lifetime → allow (already has the higher tier)', () => {
    expect(shouldAllowIapSuccess('monthly', { pro: true, permanent: false, effectiveInterval: 'lifetime' })).toBe(true);
  });

  it('5. null server or not pro → deny for both tiers', () => {
    expect(shouldAllowIapSuccess('lifetime', null)).toBe(false);
    expect(shouldAllowIapSuccess('monthly', null)).toBe(false);
    expect(shouldAllowIapSuccess('lifetime', { pro: false, permanent: false, effectiveInterval: null })).toBe(false);
    expect(shouldAllowIapSuccess('monthly', { pro: false, permanent: false, effectiveInterval: null })).toBe(false);
  });
});
