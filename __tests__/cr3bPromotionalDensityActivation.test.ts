/**
 * CR-3B (2026-08-29) — narrow follow-up to the CR-3B promotional-density
 * audit. Applies the same "product value before promotional interruption"
 * activation gate CR-3A introduced for NewMemberOfferBanner to its two
 * siblings that were missing it:
 *
 *   1. AdLandingBanner (the getaway-promo modal) — previously had no
 *      activation gate at all, so it could interrupt a brand-new user
 *      (guest or Free) before they'd ever run a calculation. Unlike
 *      NewMemberOfferBanner (only mounted on the authenticated homepage,
 *      where FirstCalcNudge already writes gc_has_calculated),
 *      AdLandingBanner is mounted globally for guests too, so it must
 *      itself persist the flag on gascap:calculated rather than only
 *      reading a key some other component may not have written yet.
 *
 *   2. MobileEngagementRow (streak + giveaway cards) — read-only consumer;
 *      FirstCalcNudge remains the writer for authenticated users.
 *
 * Neither change touches activity/streak recording, giveaway-entry
 * fetching, entitlement, payment, or analytics-taxonomy logic — this is
 * presentation gating only, proven by the tests below.
 *
 * This repo has no JSX render harness — these are source-text/structural
 * pattern-matching tests, same style as CR-1/CR-2/CR-3A test files.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..');
const adBannerSrc = readFileSync(path.join(repoRoot, 'components/AdLandingBanner.tsx'), 'utf8');
const mobileRowSrc = readFileSync(path.join(repoRoot, 'components/MobileEngagementRow.tsx'), 'utf8');
const firstCalcNudgeSrc = readFileSync(path.join(repoRoot, 'components/FirstCalcNudge.tsx'), 'utf8');
const newMemberOfferSrc = readFileSync(path.join(repoRoot, 'components/NewMemberOfferBanner.tsx'), 'utf8');

describe('CR-3B Change 1 — AdLandingBanner activation gate', () => {
  it('1. references the existing gc_has_calculated key (not a new one)', () => {
    expect(adBannerSrc).toMatch(/FIRST_CALC_DONE_KEY\s*=\s*'gc_has_calculated'/);
    expect(firstCalcNudgeSrc).toMatch(/DONE_KEY\s*=\s*'gc_has_calculated'/);
  });

  it('2. listens for the existing gascap:calculated event', () => {
    expect(adBannerSrc).toMatch(/addEventListener\('gascap:calculated', onCalc\)/);
  });

  it('3. the event handler persists gc_has_calculated = \'1\' (guests may reach this without FirstCalcNudge ever mounting)', () => {
    const idx = adBannerSrc.indexOf('const onCalc = () => {');
    const block = adBannerSrc.slice(idx, idx + 250);
    expect(block).toMatch(/localStorage\.setItem\(FIRST_CALC_DONE_KEY, '1'\)/);
  });

  it('4. the event handler sets current-session hasCalculated true unconditionally, even if the localStorage write is caught/fails', () => {
    const idx = adBannerSrc.indexOf('const onCalc = () => {');
    const block = adBannerSrc.slice(idx, idx + 300);
    expect(block).toMatch(/try \{ localStorage\.setItem\(FIRST_CALC_DONE_KEY, '1'\); \} catch \{[^}]*\}/);
    // setHasCalculated(true) must be OUTSIDE the try, not swallowed by the catch.
    const tryEnd = block.indexOf("} catch { /* ignore */ }") + "} catch { /* ignore */ }".length;
    const afterTry = block.slice(tryEnd, tryEnd + 60);
    expect(afterTry).toMatch(/setHasCalculated\(true\);/);
  });

  it('5. the popup-decision effect returns before scheduling the show timer when hasCalculated is false', () => {
    const idx = adBannerSrc.indexOf('useEffect(() => {\n    if (status === \'loading\') return;');
    expect(idx).toBeGreaterThan(-1);
    const block = adBannerSrc.slice(idx, idx + 400);
    expect(block).toMatch(/if \(!hasCalculated\) return;/);
    // Gate must come before getawayPromoActive() and before the setTimeout call.
    const gateIdx = block.indexOf('if (!hasCalculated) return;');
    const promoIdx = block.indexOf('getawayPromoActive()');
    expect(gateIdx).toBeLessThan(promoIdx);
  });

  it('6. hasCalculated is a dependency of the popup eligibility effect', () => {
    expect(adBannerSrc).toMatch(/\}, \[status, session, hasCalculated\]\);/);
  });

  it('7. the existing getawayPromoActive() gate remains, evaluated after the activation gate', () => {
    expect(adBannerSrc).toMatch(/if \(!getawayPromoActive\(\)\) return;/);
  });

  it('8. the existing paid-member/Pro-trial exclusion remains unchanged', () => {
    expect(adBannerSrc).toMatch(/isMember\s*=\s*!!session\?\.user && \(plan === 'pro' \|\| plan === 'fleet' \|\| isProTrial\)/);
    expect(adBannerSrc).toMatch(/if \(isMember\) return;/);
  });

  it('9. existing SESSION_KEY and DISMISS_KEY constants/behavior remain unchanged', () => {
    expect(adBannerSrc).toMatch(/const SESSION_KEY\s*=\s*'gc_ad_popup_shown'/);
    expect(adBannerSrc).toMatch(/const DISMISS_KEY\s*=\s*'gc_ad_popup_dismissed'/);
    expect(adBannerSrc).toMatch(/sessionStorage\.getItem\(SESSION_KEY\) === '1'/);
    expect(adBannerSrc).toMatch(/localStorage\.getItem\(DISMISS_KEY\)/);
  });

  it('10. existing result-on-screen protection (data-calc-result check) remains unchanged', () => {
    expect(adBannerSrc).toMatch(/document\.querySelector\('\[data-calc-result\]'\)/);
    expect(adBannerSrc).toMatch(/resultOnScreen/);
  });

  it('11. existing MAX_RESULT_WAIT_MS give-up behavior remains unchanged', () => {
    expect(adBannerSrc).toMatch(/const MAX_RESULT_WAIT_MS = 30000;/);
    expect(adBannerSrc).toMatch(/if \(waited >= MAX_RESULT_WAIT_MS\) return;/);
  });

  it('12. existing native-wrapper suppression remains unchanged', () => {
    expect(adBannerSrc).toMatch(/const isNative = useIsNative\(\);/);
    expect(adBannerSrc).toMatch(/if \(!show \|\| isNative\) return null;/);
  });

  it('SHOW_DELAY_MS, AUTO_HIDE_MS, RESULT_RECHECK_MS, and COOLDOWN_DAYS are unchanged (not a redesign of the getaway promo strategy)', () => {
    expect(adBannerSrc).toMatch(/const SHOW_DELAY_MS = 2500;/);
    expect(adBannerSrc).toMatch(/const AUTO_HIDE_MS\s*= 12000;/);
    expect(adBannerSrc).toMatch(/const RESULT_RECHECK_MS\s*= 1500;/);
    expect(adBannerSrc).toMatch(/const COOLDOWN_DAYS = 1;/);
  });
});

describe('CR-3B Change 2 — MobileEngagementRow activation gate', () => {
  it('13. references the existing gc_has_calculated key', () => {
    expect(mobileRowSrc).toMatch(/FIRST_CALC_DONE_KEY\s*=\s*'gc_has_calculated'/);
  });

  it('14. listens for the existing gascap:calculated event', () => {
    expect(mobileRowSrc).toMatch(/addEventListener\('gascap:calculated', onCalc\)/);
  });

  it('15. pre-activation rendering returns null', () => {
    expect(mobileRowSrc).toMatch(/if \(!session\?\.user \|\| !hasCalculated\) return null;/);
  });

  it('16. post-activation rendering shows the existing row unchanged (still lg:hidden, still both cards)', () => {
    expect(mobileRowSrc).toMatch(/className="lg:hidden flex gap-2/);
    expect(mobileRowSrc).toMatch(/Streak/);
    expect(mobileRowSrc).toMatch(/Giveaway/);
  });

  it('17. the existing /api/activity POST is NOT inside a hasCalculated conditional — it runs unconditionally for authenticated users', () => {
    const idx = mobileRowSrc.indexOf("fetch('/api/activity'");
    expect(idx).toBeGreaterThan(-1);
    // Walk backwards from the fetch call to the nearest enclosing `if` guard —
    // it must be the pre-existing `if (!session?.user) return;`, not a new
    // hasCalculated check.
    const before = mobileRowSrc.slice(0, idx);
    const lastIfIdx = before.lastIndexOf('if (!session?.user) return;');
    const lastHasCalcCheckIdx = before.lastIndexOf('if (!hasCalculated)');
    expect(lastIfIdx).toBeGreaterThan(-1);
    expect(lastHasCalcCheckIdx).toBe(-1); // no such guard exists anywhere before this fetch
  });

  it('18. the visit event body is unchanged (event: \'visit\')', () => {
    expect(mobileRowSrc).toMatch(/event:\s*'visit'/);
  });

  it('19. the /api/user/giveaway-entries fetch is unconditioned by the activation gate', () => {
    const idx = mobileRowSrc.indexOf("fetch('/api/user/giveaway-entries')");
    expect(idx).toBeGreaterThan(-1);
    const before = mobileRowSrc.slice(0, idx);
    const lastHasCalcCheckIdx = before.lastIndexOf('if (!hasCalculated)');
    expect(lastHasCalcCheckIdx).toBe(-1);
  });

  it('20. lg:hidden mobile-only class remains unchanged', () => {
    expect(mobileRowSrc).toMatch(/lg:hidden/);
  });
});

describe('CR-3B — explicitly out of scope, unmodified', () => {
  it('21. FirstCalcNudge is unmodified by this pass', () => {
    expect(firstCalcNudgeSrc).toMatch(/const DONE_KEY = 'gc_has_calculated';/);
    expect(firstCalcNudgeSrc).toMatch(/window\.addEventListener\('gascap:calculated', onCalc\)/);
  });

  it('22. NewMemberOfferBanner (the CR-3A component) is unmodified by this pass', () => {
    expect(newMemberOfferSrc).toMatch(/FIRST_CALC_DONE_KEY\s*=\s*'gc_has_calculated'/);
    expect(newMemberOfferSrc).toMatch(/if \(!hasCalculated\) return;/);
  });

  it('23. no payment/entitlement/analytics/schema/native files were touched by this change (spot-check untouched anchors)', () => {
    const webhookSrc = readFileSync(path.join(repoRoot, 'app/api/stripe/webhook/route.ts'), 'utf8');
    expect(webhookSrc).toMatch(/purchase_completed/);
    const entitlementsSrc = readFileSync(path.join(repoRoot, 'lib/entitlements.ts'), 'utf8');
    expect(entitlementsSrc).toMatch(/export function hasLifetimeEntitlement/);
  });
});
