/**
 * Phase 5A — EN/ES translation parity for the Feedback Campaign strings.
 * lib/translations.ts already enforces full key parity at compile time
 * (`const es: typeof en`), so a missing ES key would fail `tsc --noEmit`
 * before this test ever ran — this test instead guards against a key that
 * exists in both but was accidentally left as an empty string, and confirms
 * the enum-option keys (q2Options/q8Options/rentalQ2Options) line up with
 * the actual PRIMARY_FEATURE_OPTIONS/PMF_OPTIONS/RENTAL_HELPFULNESS_OPTIONS
 * lib/feedbackCampaign.ts validates against — a copy change there without a
 * matching translations update would otherwise render a blank label.
 */
import { describe, it, expect } from 'vitest';
import { getTranslations } from '@/lib/translations';
import { PRIMARY_FEATURE_OPTIONS, PMF_OPTIONS, RENTAL_HELPFULNESS_OPTIONS } from '@/lib/feedbackCampaignShared';

describe('feedbackCampaign translations', () => {
  it.each(['en', 'es'] as const)('%s has no empty feedbackCampaign string values', (locale) => {
    const t = getTranslations(locale).feedbackCampaign;
    for (const [key, value] of Object.entries(t)) {
      if (typeof value === 'string') expect(value.trim(), `${locale}.feedbackCampaign.${key}`).not.toBe('');
    }
  });

  it.each(['en', 'es'] as const)('%s q2Options covers every PRIMARY_FEATURE_OPTIONS value', (locale) => {
    const opts = getTranslations(locale).feedbackCampaign.q2Options;
    for (const feature of PRIMARY_FEATURE_OPTIONS) {
      expect(opts[feature]?.trim(), `${locale} q2Options.${feature}`).toBeTruthy();
    }
  });

  it.each(['en', 'es'] as const)('%s q8Options covers every PMF_OPTIONS value', (locale) => {
    const opts = getTranslations(locale).feedbackCampaign.q8Options;
    for (const pmf of PMF_OPTIONS) {
      expect(opts[pmf]?.trim(), `${locale} q8Options.${pmf}`).toBeTruthy();
    }
  });

  it.each(['en', 'es'] as const)('%s rentalQ2Options covers every RENTAL_HELPFULNESS_OPTIONS value', (locale) => {
    const opts = getTranslations(locale).feedbackCampaign.rentalQ2Options;
    for (const opt of RENTAL_HELPFULNESS_OPTIONS) {
      expect(opts[opt]?.trim(), `${locale} rentalQ2Options.${opt}`).toBeTruthy();
    }
  });
});
