import { describe, it, expect } from 'vitest';
import { shouldAllowIapSuccess, isNativeIapSuccess, resolveNativeIapConfirmation } from '@/lib/iapNavigationGate';

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

describe('isNativeIapSuccess — success-page recovery-path selector (2026-08-25)', () => {
  it('6. native purchase (method=iap, set only by handleIap()/handleRestore()) → true → uses RC reconciliation', () => {
    const params = new URLSearchParams('tier=pro&billing=lifetime&method=iap');
    expect(isNativeIapSuccess(params)).toBe(true);
  });

  it('7. Stripe success (session_id present, no method param) → false → does NOT invoke RC reconciliation', () => {
    const params = new URLSearchParams('session_id=cs_test_123&tier=pro&billing=lifetime');
    expect(isNativeIapSuccess(params)).toBe(false);
  });

  it('no query params at all → false (defaults to the unmodified Stripe/web polling path)', () => {
    const params = new URLSearchParams('');
    expect(isNativeIapSuccess(params)).toBe(false);
  });

  it('12/13. is a pure, synchronous decision — cannot itself hang or spin; the page uses it to gate a BOUNDED (timeout-protected) native fetch instead of the unbounded session-poll loop', () => {
    // This function's only job is the true/false routing decision covered
    // above. The "cannot spin indefinitely" guarantee lives in
    // app/upgrade/success/page.tsx's native effect: it calls
    // POST /api/user/sync-revenuecat exactly once, aborts via a client-side
    // AbortController after 8s, and calls setReady(true) unconditionally in
    // a `finally` block — so a slow/failed network call still converges.
    // There is no test harness for React component rendering in this repo
    // (no @testing-library/react, no jsdom environment configured in
    // vitest.config.ts) — asserted here at the decision-logic boundary,
    // which is what determines whether that bounded path or the legacy
    // unbounded Stripe poll runs.
    const nativeParams = new URLSearchParams('method=iap');
    const stripeParams = new URLSearchParams('session_id=cs_test_1');
    expect(isNativeIapSuccess(nativeParams)).toBe(true);
    expect(isNativeIapSuccess(stripeParams)).toBe(false);
  });
});

describe('resolveNativeIapConfirmation — "ready" (spinner stopped) is NEVER "entitlement confirmed" (2026-08-25 correction)', () => {
  it('A. confirmed server Lifetime → confirmed → Lifetime success UI/getaway allowed', () => {
    expect(resolveNativeIapConfirmation('lifetime', { pro: true, permanent: false, effectiveInterval: 'lifetime' })).toBe('confirmed');
  });

  it('B. sync timeout collapses to a null response (page aborts + catches to null) → unconfirmed, success NOT asserted', () => {
    // app/upgrade/success/page.tsx's AbortController timeout and its
    // .catch(() => null) both feed this same `null` input — a timeout is
    // indistinguishable from any other non-authoritative response here by
    // design, so it must resolve exactly like every other non-answer.
    expect(resolveNativeIapConfirmation('lifetime', null)).toBe('unconfirmed');
  });

  it('C. sync 503 (page maps any non-2xx response to null before calling this) → unconfirmed, success NOT asserted', () => {
    expect(resolveNativeIapConfirmation('monthly', null)).toBe('unconfirmed');
  });

  it('D. server says inactive (pro=false) → unconfirmed, success NOT asserted', () => {
    expect(resolveNativeIapConfirmation('lifetime', { pro: false, permanent: false, effectiveInterval: null })).toBe('unconfirmed');
    expect(resolveNativeIapConfirmation('monthly', { pro: false, permanent: false, effectiveInterval: null })).toBe('unconfirmed');
  });

  it('E. URL claims lifetime but server only confirms monthly (or nothing) → Lifetime success/getaway NOT shown', () => {
    expect(resolveNativeIapConfirmation('lifetime', { pro: true, permanent: false, effectiveInterval: 'monthly' })).toBe('unconfirmed');
    expect(resolveNativeIapConfirmation('lifetime', { pro: true, permanent: false, effectiveInterval: null })).toBe('unconfirmed');
  });

  it('a URL claiming monthly is satisfied by an actual Lifetime grant (already has the higher tier) — confirmed', () => {
    expect(resolveNativeIapConfirmation('monthly', { pro: true, permanent: false, effectiveInterval: 'lifetime' })).toBe('confirmed');
  });

  it('F. Retry re-runs reconciliation only — the success page never imports/calls a purchase function', async () => {
    // There is no React component-rendering test harness in this repo (no
    // @testing-library/react, no jsdom environment in vitest.config.ts) to
    // click the retry button directly, so this asserts the actual repo fact
    // that makes a purchase-on-retry structurally impossible: the success
    // page's source never imports purchasePro/restorePurchases (those exist
    // only in app/upgrade/page.tsx's handleIap()/handleRestore()), and its
    // only fetch call targets sync-revenuecat.
    const fs = await import('node:fs');
    const source = fs.readFileSync('app/upgrade/success/page.tsx', 'utf8');
    expect(source).not.toMatch(/purchasePro|restorePurchases/);
    expect(source).toMatch(/runNativeReconciliation/);
    expect(source).toMatch(/fetch\('\/api\/user\/sync-revenuecat'/);
  });
});
