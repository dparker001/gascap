/**
 * CR-3A (2026-08-29) — narrow follow-up to the CR-3 conversion/polish audit.
 * Two independent fixes:
 *   1. app/getaway/page.tsx's client-side Lifetime display was
 *      `stripeInterval === 'lifetime'` — provider-blind, so a RevenueCat
 *      (Apple/Google) Lifetime purchaser could be shown a "you need
 *      Lifetime" upsell despite already owning it. The authoritative
 *      app/api/getaway/choose route already used hasLifetimeEntitlement()
 *      and is unchanged; this fixes the DISPLAY to match what that route
 *      already enforces.
 *   2. NewMemberOfferBanner could fetch/show a Lifetime upsell to a
 *      brand-new user before they'd ever run a calculation. It now reuses
 *      FirstCalcNudge's existing gc_has_calculated/gascap:calculated
 *      activation signal rather than introducing a second one.
 *
 * This repo has no JSX render harness — these are source-text/structural
 * pattern-matching tests, same style as recent CR-1/CR-2 test files.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..');
const getawayPageSrc = readFileSync(path.join(repoRoot, 'app/getaway/page.tsx'), 'utf8');
const getawayChooseRouteSrc = readFileSync(path.join(repoRoot, 'app/api/getaway/choose/route.ts'), 'utf8');
const bannerSrc = readFileSync(path.join(repoRoot, 'components/NewMemberOfferBanner.tsx'), 'utf8');
const firstCalcNudgeSrc = readFileSync(path.join(repoRoot, 'components/FirstCalcNudge.tsx'), 'utf8');

describe('CR-3A Change 1 — /getaway provider-neutral Lifetime display', () => {
  it('1. app/getaway/page.tsx imports and uses hasLifetimeEntitlement', () => {
    expect(getawayPageSrc).toMatch(/import \{ hasLifetimeEntitlement \} from '@\/lib\/entitlements'/);
    expect(getawayPageSrc).toMatch(/hasLifetimeEntitlement\(\{/);
  });

  it('2. the display check considers stripeInterval, revenueCatActive, and revenueCatInterval', () => {
    expect(getawayPageSrc).toMatch(/stripeInterval\s*=.*session\?\.user/);
    expect(getawayPageSrc).toMatch(/revenueCatActive\s*=.*session\?\.user/);
    expect(getawayPageSrc).toMatch(/revenueCatInterval\s*=.*session\?\.user/);
    const callIdx = getawayPageSrc.indexOf('hasLifetimeEntitlement({');
    const callBlock = getawayPageSrc.slice(callIdx, getawayPageSrc.indexOf('}', callIdx) + 1);
    expect(callBlock).toMatch(/stripeInterval/);
    expect(callBlock).toMatch(/revenueCatActive/);
    expect(callBlock).toMatch(/revenueCatInterval/);
  });

  it('3. the page no longer defines Lifetime ownership solely as interval === \'lifetime\'', () => {
    expect(getawayPageSrc).not.toMatch(/isLifetime\s*=\s*!!session\s*&&\s*interval\s*===\s*'lifetime'/);
  });

  it('4. the authoritative app/api/getaway/choose route is unchanged and still provider-neutral', () => {
    expect(getawayChooseRouteSrc).toMatch(/import \{ hasLifetimeEntitlement \} from '@\/lib\/entitlements'/);
    expect(getawayChooseRouteSrc).toMatch(/hasLifetimeEntitlement\(\{/);
    // Regression guard against re-narrowing this route to a raw stripeInterval check.
    expect(getawayChooseRouteSrc).not.toMatch(/const isLifetime\s*=\s*user\.stripeInterval\s*===\s*'lifetime';/);
  });

  it('regression: Stripe-lifetime, RevenueCat-lifetime, non-lifetime, signed-out, and promo-inactive states all remain distinguishable in the render logic', () => {
    expect(getawayPageSrc).toMatch(/getawayPickerInactive/); // promo inactive
    expect(getawayPageSrc).toMatch(/getawayPickerSignIn/);   // signed out
    expect(getawayPageSrc).toMatch(/getawayPickerNeedsLifetime/); // non-lifetime
    expect(getawayPageSrc).toMatch(/<GetawayDestinationPicker/); // lifetime (any provider)
  });
});

describe('CR-3A Change 2 — NewMemberOfferBanner gated on first-calculation activation', () => {
  it('5. NewMemberOfferBanner references the existing gc_has_calculated key (not a new one)', () => {
    expect(bannerSrc).toMatch(/FIRST_CALC_DONE_KEY\s*=\s*'gc_has_calculated'/);
    // Same literal key FirstCalcNudge already owns — not a second flag.
    expect(firstCalcNudgeSrc).toMatch(/DONE_KEY\s*=\s*'gc_has_calculated'/);
  });

  it('6. NewMemberOfferBanner listens for the existing gascap:calculated event', () => {
    expect(bannerSrc).toMatch(/addEventListener\('gascap:calculated', onCalc\)/);
    expect(firstCalcNudgeSrc).toMatch(/'gascap:calculated'/);
  });

  it('7. before first calculation, the eligibility fetch does not fire', () => {
    const idx = bannerSrc.indexOf("if (!session?.user) return;");
    const effectBlock = bannerSrc.slice(idx, bannerSrc.indexOf('}, [session, hasCalculated]);'));
    expect(effectBlock).toMatch(/if \(!hasCalculated\) return;/);
    // The hasCalculated gate must come before the fetch call.
    const gateIdx = effectBlock.indexOf('if (!hasCalculated) return;');
    const fetchIdx = effectBlock.indexOf("fetch('/api/user/new-member-offer')");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(fetchIdx);
  });

  it('8. after first calculation, eligibility can be evaluated (hasCalculated is a dependency of the fetch effect)', () => {
    expect(bannerSrc).toMatch(/\}, \[session, hasCalculated\]\);/);
  });

  it('9. existing getawayPromoActive() suppression remains intact and still runs after the activation gate', () => {
    const idx = bannerSrc.indexOf('if (!hasCalculated) return;');
    const afterGate = bannerSrc.slice(idx, bannerSrc.indexOf('}, [session, hasCalculated]);'));
    expect(afterGate).toMatch(/if \(getawayPromoActive\(\)\) return;/);
  });

  it('10. existing native-wrapper suppression (useIsNative) remains intact', () => {
    expect(bannerSrc).toMatch(/const isNative = useIsNative\(\);/);
    expect(bannerSrc).toMatch(/if \(!session\?\.user \|\| daysLeft === null \|\| isNative\) return null;/);
  });

  it('activation state is read from localStorage on mount (returning users who already calculated on a prior visit)', () => {
    const idx = bannerSrc.indexOf('useEffect(() => {\n    if (typeof window === \'undefined\') return;');
    expect(idx).toBeGreaterThan(-1);
    const block = bannerSrc.slice(idx, idx + 500);
    expect(block).toMatch(/localStorage\.getItem\(FIRST_CALC_DONE_KEY\) === '1'/);
    expect(block).toMatch(/setHasCalculated\(true\)/);
  });

  it('blocked localStorage is handled safely (try/catch, fails to not-yet-activated rather than throwing)', () => {
    const idx = bannerSrc.indexOf("localStorage.getItem(FIRST_CALC_DONE_KEY)");
    const surrounding = bannerSrc.slice(Math.max(0, idx - 100), idx + 150);
    expect(surrounding).toMatch(/try \{/);
    expect(surrounding).toMatch(/catch/);
  });
});

describe('CR-3A — server-side eligibility exclusion (existing Lifetime owners) untouched', () => {
  it('11. server-side eligibility (newMemberOfferStatus, called by the route) still excludes existing Lifetime owners — unmodified by this pass', () => {
    const offerSrc = readFileSync(path.join(repoRoot, 'lib/newMemberOffer.ts'), 'utf8');
    expect(offerSrc).toMatch(/hasLifetimeEntitlement/);
  });
});

describe('CR-3A — explicitly out of scope, unmodified', () => {
  it('no purchase-analytics files were touched (purchase_completed already exists for Stripe and is untouched)', () => {
    const webhookSrc = readFileSync(path.join(repoRoot, 'app/api/stripe/webhook/route.ts'), 'utf8');
    expect(webhookSrc).toMatch(/purchase_completed/);
  });

  it('no entitlement mutation logic was modified — hasLifetimeEntitlement itself is read-only pure logic, untouched', () => {
    const entitlementsSrc = readFileSync(path.join(repoRoot, 'lib/entitlements.ts'), 'utf8');
    expect(entitlementsSrc).toMatch(/export function hasLifetimeEntitlement\(input: LifetimeCheckInput\): boolean \{/);
    expect(entitlementsSrc).toMatch(/return input\.stripeInterval === 'lifetime'/);
  });

  it('NEW_MEMBER_DISCOUNT_USD, coupon ID, and eligibility window are unchanged (comment-only cleanup)', () => {
    const offerSrc = readFileSync(path.join(repoRoot, 'lib/newMemberOffer.ts'), 'utf8');
    expect(offerSrc).toMatch(/NEW_MEMBER_DISCOUNT_USD = 10/);
    expect(offerSrc).toMatch(/NEW_MEMBER_OFFER_DAYS\s*=\s*7/);
    expect(offerSrc).toMatch(/NEW_MEMBER_LIFETIME_COUPON/);
  });

  it('stale $5/$14.99 comment was corrected to match the actual $10/$9.99 (50% off) offer', () => {
    const offerSrc = readFileSync(path.join(repoRoot, 'lib/newMemberOffer.ts'), 'utf8');
    expect(offerSrc).not.toMatch(/\$5 discount/);
    expect(offerSrc).not.toMatch(/\$14\.99/);
    expect(offerSrc).toMatch(/\$10 discount/);
    expect(offerSrc).toMatch(/\$9\.99/);
  });
});
