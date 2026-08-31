/**
 * CR-3C-B (2026-08-29) — narrow follow-up to the CR-3C completion pass.
 * Fixes exactly two verified P1 issues:
 *
 *   1. PricingSection.handleUpgrade() had no error handling at all: a
 *      failed checkout (non-2xx, missing url, or a thrown network/JSON
 *      error) silently reset the loading spinner with no visible outcome.
 *      Now mirrors /upgrade's existing checkout-failure pattern with a
 *      minimal `error` state rendered via role="alert".
 *
 *   2. app/api/stripe/checkout/route.ts already computed the
 *      provider-neutral `isLifetimeAnyProvider` (via hasLifetimeEntitlement)
 *      but only applied it to the founding/lifetime-perks branches — not
 *      the ordinary plain-`lifetime` purchase path. An existing Lifetime
 *      owner (Stripe OR RevenueCat) could reach Stripe Checkout Session
 *      creation for another Lifetime purchase if the client-side gate
 *      (already fixed in CR-3C-A) ever regressed. Added a server-side
 *      backstop returning 409 before any Checkout Session is created.
 *
 * Explicitly NOT in scope: feature-attribution query params, returnTo/
 * resume-after-upgrade behavior (CR-3C-C), Monthly duplicate-purchase
 * policy, any change to hasLifetimeEntitlement/entitlement persistence/
 * Stripe or RevenueCat webhooks/lib/iap.ts.
 *
 * This repo has no JSX render harness — these are source-text/structural
 * pattern-matching tests, same style as prior CR test files.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..');
const pricingSrc = readFileSync(path.join(repoRoot, 'components/PricingSection.tsx'), 'utf8');
const checkoutRouteSrc = readFileSync(path.join(repoRoot, 'app/api/stripe/checkout/route.ts'), 'utf8');

describe('CR-3C-B Change 1 — PricingSection checkout-failure UX', () => {
  const fnStart = pricingSrc.indexOf('async function handleUpgrade(billing:');
  const fnEnd = pricingSrc.indexOf('\n  }\n', pricingSrc.indexOf('finally {', fnStart));
  const fnBlock = pricingSrc.slice(fnStart, fnEnd);

  it('1. has an error state', () => {
    expect(pricingSrc).toMatch(/const \[error, setError\]\s*=\s*useState\(''\);/);
  });

  it('2. clears prior error before the checkout attempt', () => {
    const setLoadingIdx = fnBlock.indexOf('setLoading(billing);');
    const setErrorIdx = fnBlock.indexOf("setError('');");
    const fetchIdx = fnBlock.indexOf("fetch('/api/stripe/checkout'");
    expect(setLoadingIdx).toBeGreaterThan(-1);
    expect(setErrorIdx).toBeGreaterThan(-1);
    expect(setErrorIdx).toBeLessThan(fetchIdx);
  });

  it('3. still POSTs the same { tier: \'pro\', billing } body', () => {
    expect(fnBlock).toMatch(/body:\s*JSON\.stringify\(\{ tier: 'pro', billing \}\)/);
  });

  it('4. redirects when data.url exists', () => {
    expect(fnBlock).toMatch(/if \(data\.url\) \{\s*window\.location\.href = data\.url;/);
  });

  it('5. surfaces data.error when no URL exists', () => {
    expect(fnBlock).toMatch(/setError\(data\.error \?\? 'Something went wrong\.'\);/);
  });

  it('6. has a generic fallback when data.error is absent', () => {
    expect(fnBlock).toMatch(/\?\? 'Something went wrong\.'/);
  });

  it('7/8. catches network/exception failures with a customer-visible message', () => {
    expect(fnBlock).toMatch(/\} catch \{\s*setError\('Network error — please try again\.'\);\s*\}/);
  });

  it('9. loading still resets in finally', () => {
    expect(fnBlock).toMatch(/\} finally \{\s*setLoading\(null\);\s*\}/);
  });

  it('10. the error UI uses role="alert"', () => {
    const idx = pricingSrc.indexOf('{error && (');
    const block = pricingSrc.slice(idx, idx + 250);
    expect(block).toMatch(/role="alert"/);
    expect(block).toMatch(/\{error\}/);
  });

  it('11/12. Monthly and Lifetime CTA logic (isProMonthly/isProLifetime) are unchanged', () => {
    expect(pricingSrc).toMatch(/const isProMonthly\s*=\s*!!session && userPlan === 'pro' && userInterval === 'monthly' && !isOnTrial;/);
    expect(pricingSrc).toMatch(/disabled=\{loading !== null \|\| isProLifetime\}/);
  });

  it('13. provider-neutral isProLifetime (CR-3C-A) remains intact', () => {
    expect(pricingSrc).toMatch(/hasLifetimeEntitlement\(\{ stripeInterval: userInterval, revenueCatActive, revenueCatInterval \}\)/);
  });

  it('no analytics call was added to this function', () => {
    expect(fnBlock).not.toMatch(/trackClientEvent|trackUpgradeClick|gtag/);
  });
});

describe('CR-3C-B Change 2 — server-side duplicate-Lifetime backstop', () => {
  const guardIdx = checkoutRouteSrc.indexOf("if (validatedBilling === 'lifetime' && isLifetimeAnyProvider)");
  const guardBlock = checkoutRouteSrc.slice(guardIdx, guardIdx + 200);

  it('14. the existing hasLifetimeEntitlement call remains provider-neutral (unchanged fields)', () => {
    const idx = checkoutRouteSrc.indexOf('const isLifetimeAnyProvider = hasLifetimeEntitlement({');
    const block = checkoutRouteSrc.slice(idx, idx + 250);
    expect(block).toMatch(/stripeInterval:\s*user\.stripeInterval\s*\?\?\s*null/);
    expect(block).toMatch(/revenueCatActive:\s*user\.revenueCatActive\s*\?\?\s*false/);
    expect(block).toMatch(/revenueCatInterval:\s*user\.revenueCatInterval\s*\?\?\s*null/);
  });

  it('15/16/17. plain validatedBilling === \'lifetime\' is rejected with 409 and a customer-readable message when isLifetimeAnyProvider is true', () => {
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardBlock).toMatch(/status:\s*409/);
    expect(guardBlock).toMatch(/error:\s*'You already have Pro Lifetime\.'/);
  });

  it('18. the guard does not block lifetime-perks (different validatedBilling value entirely)', () => {
    // The guard's condition is a strict equality against 'lifetime', so
    // 'lifetime-perks' can never satisfy it. Confirm lifetime-perks still
    // has its own, separate isLifetimeAnyProvider-based gate (inverted:
    // REQUIRES it, doesn't reject on it).
    const perksIdx = checkoutRouteSrc.indexOf("if (billing === 'lifetime-perks')");
    const perksBlock = checkoutRouteSrc.slice(perksIdx, perksIdx + 300);
    expect(perksBlock).toMatch(/if \(!isLifetimeAnyProvider\)/);
    expect(perksBlock).toMatch(/Lifetime Perks are only available to Pro Lifetime Membership holders\./);
  });

  it('19. monthly is not blocked by the new guard', () => {
    // The guard is scoped to validatedBilling === 'lifetime' only; a
    // structural check that 'monthly' billing has no such gate near it.
    const monthlyPriceIdx = checkoutRouteSrc.indexOf("validatedBilling === 'lifetime' ? PRICES.proLifetime : PRICES.proMonthly");
    expect(monthlyPriceIdx).toBeGreaterThan(-1);
  });

  it('20. the guard returns before any Stripe Checkout Session is created (appears before stripe.checkout.sessions.create)', () => {
    const sessionCreateIdx = checkoutRouteSrc.indexOf('stripe.checkout.sessions.create');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(sessionCreateIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(sessionCreateIdx);
  });
});

describe('CR-3C-B — explicitly out of scope, unmodified', () => {
  it('21. app/upgrade/page.tsx untouched by this pass', () => {
    const upgradeSrc = readFileSync(path.join(repoRoot, 'app/upgrade/page.tsx'), 'utf8');
    expect(upgradeSrc).toMatch(/hasLifetimeEntitlement\(\{/);
  });

  it('22. app/upgrade/success/page.tsx untouched by this pass', () => {
    const successSrc = readFileSync(path.join(repoRoot, 'app/upgrade/success/page.tsx'), 'utf8');
    expect(successSrc).toMatch(/router\.push\('\/'\)/);
  });

  it('23. lib/entitlements.ts (hasLifetimeEntitlement itself) untouched', () => {
    const entitlementsSrc = readFileSync(path.join(repoRoot, 'lib/entitlements.ts'), 'utf8');
    expect(entitlementsSrc).toMatch(/export function hasLifetimeEntitlement\(input: LifetimeCheckInput\): boolean \{/);
    expect(entitlementsSrc).toMatch(/return input\.stripeInterval === 'lifetime'/);
  });

  it('24. Stripe webhook untouched', () => {
    const webhookSrc = readFileSync(path.join(repoRoot, 'app/api/stripe/webhook/route.ts'), 'utf8');
    expect(webhookSrc).toMatch(/purchase_completed/);
  });

  it('25. RevenueCat webhook/IAP untouched', () => {
    const revenueCatSrc = readFileSync(path.join(repoRoot, 'app/api/native/revenuecat/route.ts'), 'utf8');
    expect(revenueCatSrc).toMatch(/purchase_completed/);
    const iapSrc = readFileSync(path.join(repoRoot, 'lib/iap.ts'), 'utf8');
    expect(iapSrc).toMatch(/purchasePro/);
  });

  it('26. no feature-attribution/returnTo query params were introduced anywhere in this diff\'s files', () => {
    expect(pricingSrc).not.toMatch(/returnTo|upgradeSource|offerSource=/);
    expect(checkoutRouteSrc).not.toMatch(/returnTo/);
  });
});
