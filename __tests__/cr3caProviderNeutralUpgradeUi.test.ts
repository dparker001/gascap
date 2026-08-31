/**
 * CR-3C-A (2026-08-29) — narrow follow-up to the CR-3C pricing/upgrade
 * conversion audit. Fixes the one verified P1 finding: PricingSection.tsx
 * and app/upgrade/page.tsx both derived Lifetime ownership from the raw,
 * Stripe-specific `stripeInterval === 'lifetime'` check instead of the
 * already-exported, provider-neutral hasLifetimeEntitlement() helper (the
 * same helper PlanBadge.tsx and app/getaway/page.tsx already use correctly).
 * A RevenueCat (Apple/Google) Lifetime purchaser was shown a duplicate
 * "Get Lifetime — $19.99" CTA and incorrect getaway/plan-state UI.
 *
 * This is a display/gating fix only — no payment, entitlement-persistence,
 * pricing, checkout, or native IAP logic is touched.
 *
 * This repo has no JSX render harness — these are source-text/structural
 * pattern-matching tests, same style as CR-1/CR-2/CR-3A/CR-3B test files.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..');
const pricingSrc = readFileSync(path.join(repoRoot, 'components/PricingSection.tsx'), 'utf8');
const upgradeSrc = readFileSync(path.join(repoRoot, 'app/upgrade/page.tsx'), 'utf8');
const entitlementsSrc = readFileSync(path.join(repoRoot, 'lib/entitlements.ts'), 'utf8');
const planBadgeSrc = readFileSync(path.join(repoRoot, 'components/PlanBadge.tsx'), 'utf8');
const getawayPageSrc = readFileSync(path.join(repoRoot, 'app/getaway/page.tsx'), 'utf8');

describe('CR-3C-A Change 1 — PricingSection.tsx provider-neutral Lifetime ownership', () => {
  it('1. imports hasLifetimeEntitlement', () => {
    expect(pricingSrc).toMatch(/import \{ hasLifetimeEntitlement \} from '@\/lib\/entitlements'/);
  });

  it('2. reads stripeInterval, revenueCatActive, and revenueCatInterval from the session', () => {
    expect(pricingSrc).toMatch(/userInterval\s*=\s*\(session\?\.user as \{ stripeInterval/);
    expect(pricingSrc).toMatch(/revenueCatActive\s*=\s*\(session\?\.user as \{ revenueCatActive/);
    expect(pricingSrc).toMatch(/revenueCatInterval\s*=\s*\(session\?\.user as \{ revenueCatInterval/);
  });

  it('3/4. isProLifetime is derived via hasLifetimeEntitlement(), receiving all three provider fields', () => {
    const idx = pricingSrc.indexOf('const isProLifetime');
    const block = pricingSrc.slice(idx, pricingSrc.indexOf(';', pricingSrc.indexOf('hasLifetimeEntitlement(', idx)) + 1);
    expect(block).toMatch(/hasLifetimeEntitlement\(\{/);
    expect(block).toMatch(/stripeInterval:\s*userInterval/);
    expect(block).toMatch(/revenueCatActive/);
    expect(block).toMatch(/revenueCatInterval/);
  });

  it('5. isProLifetime still requires session, userPlan === \'pro\', and !isOnTrial', () => {
    const idx = pricingSrc.indexOf('const isProLifetime');
    const block = pricingSrc.slice(idx, idx + 300);
    expect(block).toMatch(/!!session/);
    expect(block).toMatch(/userPlan === 'pro'/);
    expect(block).toMatch(/!isOnTrial/);
  });

  it('6. no longer defines Lifetime ownership solely through a raw interval === \'lifetime\' check', () => {
    expect(pricingSrc).not.toMatch(/const isProLifetime\s*=\s*!!session && userPlan === 'pro' && userInterval === 'lifetime' && !isOnTrial;/);
  });

  it('7/8. isProMonthly and isProAnnual are unchanged', () => {
    expect(pricingSrc).toMatch(/const isProMonthly\s*=\s*!!session && userPlan === 'pro' && userInterval === 'monthly' && !isOnTrial;/);
    expect(pricingSrc).toMatch(/const isProAnnual\s*=\s*!!session && userPlan === 'pro' && userInterval === 'annual'\s*&& !isOnTrial;/);
  });

  it('9. showGetaway remains based on !isProLifetime', () => {
    expect(pricingSrc).toMatch(/const showGetaway\s*=\s*getawayPromoActive\(\) && !isProLifetime;/);
  });

  it('10/11. Lifetime CTA disabled state and Monthly CTA already-entitled logic still reference isProLifetime', () => {
    expect(pricingSrc).toMatch(/disabled=\{loading !== null \|\| isProLifetime\}/);
    expect(pricingSrc).toMatch(/disabled=\{loading !== null \|\| isProMonthly \|\| isProAnnual \|\| isProLifetime\}/);
  });
});

describe('CR-3C-A Change 2 — app/upgrade/page.tsx provider-neutral Lifetime ownership', () => {
  it('12. imports hasLifetimeEntitlement', () => {
    expect(upgradeSrc).toMatch(/import \{ hasLifetimeEntitlement \} from '@\/lib\/entitlements'/);
  });

  it('13. reads stripeInterval, revenueCatActive, and revenueCatInterval from the session', () => {
    expect(upgradeSrc).toMatch(/userInterval\s*=\s*\(session\?\.user as \{ stripeInterval/);
    expect(upgradeSrc).toMatch(/revenueCatActive\s*=\s*\(session\?\.user as \{ revenueCatActive/);
    expect(upgradeSrc).toMatch(/revenueCatInterval\s*=\s*\(session\?\.user as \{ revenueCatInterval/);
  });

  it('14/15. isProLifetime is derived via hasLifetimeEntitlement(), receiving all three provider fields', () => {
    const idx = upgradeSrc.indexOf('const isProLifetime');
    const block = upgradeSrc.slice(idx, upgradeSrc.indexOf(';', upgradeSrc.indexOf('hasLifetimeEntitlement(', idx)) + 1);
    expect(block).toMatch(/hasLifetimeEntitlement\(\{/);
    expect(block).toMatch(/stripeInterval:\s*userInterval/);
    expect(block).toMatch(/revenueCatActive/);
    expect(block).toMatch(/revenueCatInterval/);
  });

  it('16. no longer defines Lifetime ownership solely with a raw interval === \'lifetime\' check', () => {
    expect(upgradeSrc).not.toMatch(/const isProLifetime\s*=\s*!!session && userPlan === 'pro' && userInterval === 'lifetime' && !isOnTrial;/);
  });

  it('17. showGetaway still uses !isProLifetime', () => {
    expect(upgradeSrc).toMatch(/const showGetaway\s*=\s*getawayPromoActive\(\) && !isProLifetime;/);
  });

  it('18. the auto=lifetime duplicate-purchase guard still uses isProLifetime', () => {
    expect(upgradeSrc).toMatch(/if \(auto === 'lifetime' && isProLifetime\) return;/);
  });

  it('19. the auto=monthly guard still treats isProLifetime as already-Pro', () => {
    expect(upgradeSrc).toMatch(/if \(auto === 'monthly' && \(isProMonthly \|\| isProAnnual \|\| isProLifetime\)\) return;/);
  });

  it('20. Stripe/native checkout functions (purchasePro, restorePurchases, /api/stripe/checkout) are unchanged references', () => {
    expect(upgradeSrc).toMatch(/import \{ purchasePro, restorePurchases \} from '@\/lib\/iap'/);
    expect(upgradeSrc).toMatch(/shouldAllowIapSuccess/);
  });
});

describe('CR-3C-A — explicitly out of scope, unmodified', () => {
  it('21. lib/entitlements.ts (hasLifetimeEntitlement itself) is untouched', () => {
    expect(entitlementsSrc).toMatch(/export function hasLifetimeEntitlement\(input: LifetimeCheckInput\): boolean \{/);
    expect(entitlementsSrc).toMatch(/return input\.stripeInterval === 'lifetime'/);
  });

  it('22. PlanBadge.tsx is untouched (already used the correct pattern)', () => {
    expect(planBadgeSrc).toMatch(/hasLifetimeEntitlement\(\{/);
  });

  it('23. app/getaway/page.tsx is untouched (already fixed in CR-3A)', () => {
    expect(getawayPageSrc).toMatch(/hasLifetimeEntitlement\(\{/);
  });

  it('24. no payment/webhook/IAP/schema/native-project files were modified — spot-check untouched anchors', () => {
    const webhookSrc = readFileSync(path.join(repoRoot, 'app/api/stripe/webhook/route.ts'), 'utf8');
    expect(webhookSrc).toMatch(/purchase_completed/);
    const checkoutSrc = readFileSync(path.join(repoRoot, 'app/api/stripe/checkout/route.ts'), 'utf8');
    expect(checkoutSrc).toMatch(/billing/);
  });
});
