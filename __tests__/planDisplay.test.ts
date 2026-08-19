/**
 * Regression tests for the Settings → Plan card's trial-vs-paid-Pro
 * decision logic (see lib/planDisplay.ts's doc comment for the bug this
 * fixes — a Pro TRIAL user on iOS was shown "Manage your subscription in
 * iPhone Settings" instead of an Upgrade CTA).
 */
import { describe, it, expect } from 'vitest';
import { resolvePlanCardCta, resolvePlanLabel } from '@/lib/planDisplay';

describe('resolvePlanCardCta', () => {
  it('trial + iOS => ios-trial-upgrade (the core bug fix)', () => {
    const cta = resolvePlanCardCta({ plan: 'pro', isProTrial: true, isProLifetime: false, isIos: true });
    expect(cta).toBe('ios-trial-upgrade');
  });

  it('paid Pro (not trial) + iOS => apple-manage', () => {
    const cta = resolvePlanCardCta({ plan: 'pro', isProTrial: false, isProLifetime: false, isIos: true });
    expect(cta).toBe('apple-manage');
  });

  it('free + iOS => none (free plan is a separate block that already shows the Upgrade CTA)', () => {
    const cta = resolvePlanCardCta({ plan: 'free', isProTrial: false, isProLifetime: false, isIos: true });
    expect(cta).toBe('none');
  });

  it('trial + web (not iOS) => other-pro-block — web behavior is unchanged by this fix', () => {
    const cta = resolvePlanCardCta({ plan: 'pro', isProTrial: true, isProLifetime: false, isIos: false });
    expect(cta).toBe('other-pro-block');
  });

  it('trial + Android (isNative but not iOS) => other-pro-block — Android behavior is unchanged by this fix', () => {
    const cta = resolvePlanCardCta({ plan: 'pro', isProTrial: true, isProLifetime: false, isIos: false });
    expect(cta).toBe('other-pro-block');
  });

  it('paid Pro Lifetime + iOS => none — Lifetime has its own dedicated block, not this one', () => {
    const cta = resolvePlanCardCta({ plan: 'pro', isProTrial: false, isProLifetime: true, isIos: true });
    expect(cta).toBe('none');
  });

  it('a trial user is never routed to apple-manage, on any platform', () => {
    for (const isIos of [true, false]) {
      const cta = resolvePlanCardCta({ plan: 'pro', isProTrial: true, isProLifetime: false, isIos });
      expect(cta).not.toBe('apple-manage');
    }
  });

  it('fleet plan => none (handled by a separate block entirely)', () => {
    const cta = resolvePlanCardCta({ plan: 'fleet', isProTrial: false, isProLifetime: false, isIos: true });
    expect(cta).toBe('none');
  });
});

describe('resolvePlanLabel', () => {
  it('Pro trial => "trial" label, never plain "Pro"', () => {
    const label = resolvePlanLabel({ plan: 'pro', isProTrial: true, isProLifetime: false, isProAnnual: false });
    expect(label).toBe('trial');
  });

  it('paid Pro (not trial) => "plain" label', () => {
    const label = resolvePlanLabel({ plan: 'pro', isProTrial: false, isProLifetime: false, isProAnnual: false });
    expect(label).toBe('plain');
  });

  it('Pro Lifetime takes priority over trial labeling (a Lifetime purchase is never itself "on trial")', () => {
    const label = resolvePlanLabel({ plan: 'pro', isProTrial: false, isProLifetime: true, isProAnnual: false });
    expect(label).toBe('lifetime');
  });

  it('Pro Annual takes priority over plain Pro labeling', () => {
    const label = resolvePlanLabel({ plan: 'pro', isProTrial: false, isProLifetime: false, isProAnnual: true });
    expect(label).toBe('annual');
  });

  it('free plan => "plain" label (rendered as "Free" elsewhere via planFreeLabel)', () => {
    const label = resolvePlanLabel({ plan: 'free', isProTrial: false, isProLifetime: false, isProAnnual: false });
    expect(label).toBe('plain');
  });
});
