/**
 * Phase 2A conversion patch (2026-08-25) — content-level regression coverage
 * for the copy/translation changes in lib/translations.ts. Does not touch
 * pricing, entitlement, or the getaway 72-hour fulfillment logic; only
 * asserts the required strings exist and forbidden phrasing does not.
 */
import { describe, it, expect } from 'vitest';
import { translations } from '@/lib/translations';

describe('Phase 2A — Rental Return Mode added to Pro feature list', () => {
  it('EN proFeatures mentions Rental Return Mode', () => {
    const hit = translations.en.pricing.proFeatures.some((f: string) => /rental return mode/i.test(f));
    expect(hit).toBe(true);
  });

  it('ES proFeatures mentions the Spanish Rental Return Mode name', () => {
    const hit = translations.es.pricing.proFeatures.some((f: string) => /devoluci[oó]n de auto de alquiler/i.test(f));
    expect(hit).toBe(true);
  });

  it('EN/ES rentalReturnModeHighlight key exists for the Lifetime card bullet', () => {
    expect(typeof translations.en.pricing.rentalReturnModeHighlight).toBe('string');
    expect(typeof translations.es.pricing.rentalReturnModeHighlight).toBe('string');
    expect(translations.en.pricing.rentalReturnModeHighlight.length).toBeGreaterThan(0);
    expect(translations.es.pricing.rentalReturnModeHighlight.length).toBeGreaterThan(0);
  });
});

describe('Phase 2A — vacation getaway reframed as a Lifetime bonus, not a free/guaranteed perk', () => {
  it('EN getawayPill does not claim the getaway is free/complimentary', () => {
    expect(translations.en.pricing.getawayPill.toLowerCase()).not.toContain('free');
    expect(translations.en.pricing.getawayPill.toLowerCase()).not.toContain('complimentary');
  });

  it('ES getawayPill does not claim the getaway is free ("gratis")', () => {
    expect(translations.es.pricing.getawayPill.toLowerCase()).not.toContain('gratis');
  });

  it('EN/ES getawayCardMsg does not reference an outdated 7-day GasCap hold', () => {
    expect(translations.en.pricing.getawayCardMsg).not.toMatch(/7[\s-]day/i);
    expect(translations.es.pricing.getawayCardMsg).not.toMatch(/7\s*d[ií]as/i);
  });

  it('EN/ES getawayCardMsg does not use "complimentary" language implying no cost', () => {
    expect(translations.en.pricing.getawayCardMsg.toLowerCase()).not.toContain('complimentary');
  });
});
