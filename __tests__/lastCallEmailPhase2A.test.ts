/**
 * Phase 2A conversion patch (2026-08-25) — regression coverage for the single
 * added Lifetime-vs-Monthly comparison line in the day-28 "Final 48 Hours"
 * trial email (lib/emailCampaign.ts). No pricing changed; this only asserts
 * the new comparison sentence is present in both the HTML and text variants.
 */
import { describe, it, expect } from 'vitest';
import { lastCallEmailHtml, lastCallEmailText } from '@/lib/emailCampaign';

describe('Phase 2A — day-28 trial email Lifetime comparison line', () => {
  it('HTML variant includes the one-payment Lifetime comparison sentence', () => {
    const html = lastCallEmailHtml('Jamie Rivera', 'user-1');
    expect(html).toContain('Lifetime is $19.99');
    expect(html).toMatch(/less than 7 months of Monthly/i);
  });

  it('text variant includes the same comparison sentence', () => {
    const text = lastCallEmailText('Jamie Rivera');
    expect(text).toContain('Lifetime is $19.99');
    expect(text).toMatch(/less than 7 months of Monthly/i);
  });

  it('does not change the underlying prices themselves', () => {
    const html = lastCallEmailHtml('Jamie Rivera', 'user-1');
    expect(html).toContain('$2.99');
    expect(html).toContain('$19.99');
  });
});
