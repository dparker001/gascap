/**
 * TC-2A (2026-09-01) — personalized Trial Value recap in the Day-21, Day-28,
 * and trial-ended emails (lib/emailCampaign.ts).
 *
 * Proves: each template renders a personalized section given non-zero
 * reliable values; a zero-activity user gets the existing generic copy with
 * no personalized section; singular/plural grammar is correct; no template
 * contains a fabricated "$X saved" string; $2.99 Monthly / $19.99 Lifetime
 * are unchanged; Lifetime's one-time nature remains stated.
 */
import { describe, it, expect } from 'vitest';
import {
  annualDealEmailHtml, annualDealEmailText,
  lastCallEmailHtml, lastCallEmailText,
  trialEndedEmailHtml, trialEndedEmailText,
} from '@/lib/emailCampaign';
import type { TrialValueSummary } from '@/lib/trialValue';

const ZERO: TrialValueSummary = { calculations: 0, vehicles: 0, fillups: 0, rentalSessions: 0 };
const SOME: TrialValueSummary = { calculations: 4, vehicles: 1, fillups: 2, rentalSessions: 0 };
const PLURAL: TrialValueSummary = { calculations: 6, vehicles: 2, fillups: 5, rentalSessions: 3 };

const HTML_RENDERERS: Array<[string, (n: string, id: string, tv?: TrialValueSummary | null) => string]> = [
  ['Day-21 (annualDealEmailHtml)', annualDealEmailHtml],
  ['Day-28 (lastCallEmailHtml)',   lastCallEmailHtml],
  ['trial-ended (trialEndedEmailHtml)', trialEndedEmailHtml],
];

describe.each(HTML_RENDERERS)('%s', (_label, render) => {
  it('renders a personalized recap section for non-zero reliable values', () => {
    const html = render('Jane Doe', 'user-1', SOME);
    expect(html).toContain('4 GasCap calculations');
    expect(html).toContain('1 vehicle saved');
    expect(html).toContain('2 fill-ups logged');
    // rentalSessions is 0 in SOME — must not appear
    expect(html).not.toMatch(/0 rentals?/);
  });

  it('uses correct plural grammar for values > 1', () => {
    const html = render('Jane Doe', 'user-1', PLURAL);
    expect(html).toContain('6 GasCap calculations');
    expect(html).toContain('2 vehicles saved');
    expect(html).toContain('5 fill-ups logged');
    expect(html).toContain('3 rentals tracked');
  });

  it('renders the existing generic copy with no personalized section when all values are zero', () => {
    const html = render('Jane Doe', 'user-1', ZERO);
    expect(html).not.toContain('GasCap calculation');
    expect(html).not.toContain('vehicle saved');
    expect(html).not.toContain('fill-up logged');
    expect(html).not.toContain("Here's what you've done with GasCap");
  });

  it('renders the existing generic copy when no trial value is passed at all (default)', () => {
    const html = render('Jane Doe', 'user-1');
    expect(html).not.toContain("Here's what you've done with GasCap");
  });

  it('never contains a fabricated dollar-savings claim', () => {
    const html = render('Jane Doe', 'user-1', PLURAL);
    expect(html).not.toMatch(/you('|’)?ve saved \$/i);
    expect(html).not.toMatch(/you saved \$/i);
  });

  it('$2.99 Monthly and $19.99 Lifetime figures are present and unchanged', () => {
    const html = render('Jane Doe', 'user-1', SOME);
    expect(html).toContain('$2.99');
    expect(html).toContain('$19.99');
  });

  it("Lifetime's one-time nature remains clearly stated", () => {
    const html = render('Jane Doe', 'user-1', SOME);
    expect(html.toLowerCase()).toMatch(/one payment|one-time|no subscription/);
  });
});

describe('text variants', () => {
  it('annualDealEmailText includes the recap when given non-zero values', () => {
    const text = annualDealEmailText('Jane', SOME);
    expect(text).toContain('4 GasCap calculations');
    expect(text).toContain('1 vehicle saved');
  });

  it('annualDealEmailText omits the recap for zero activity', () => {
    const text = annualDealEmailText('Jane', ZERO);
    expect(text).not.toContain('GasCap calculation');
  });

  it('lastCallEmailText includes the recap when given non-zero values', () => {
    const text = lastCallEmailText('Jane', SOME);
    expect(text).toContain('2 fill-ups logged');
  });

  it('trialEndedEmailText includes the recap when given non-zero values', () => {
    const text = trialEndedEmailText('Jane', SOME);
    expect(text).toContain('1 vehicle saved');
  });

  it('trialEndedEmailText never implies data was deleted (any "delet-" mention must be a negation)', () => {
    const text = trialEndedEmailText('Jane', SOME);
    const lower = text.toLowerCase();
    if (/delet/.test(lower)) {
      expect(lower).toMatch(/(nothing was |not )lost or deleted/);
    }
    expect(lower).toMatch(/safe|not lost|nothing was lost/);
  });
});

describe('trial-ended email — data-not-deleted copy', () => {
  it('html explicitly says nothing was lost or deleted', () => {
    const html = trialEndedEmailHtml('Jane', 'user-1', SOME);
    expect(html.toLowerCase()).toMatch(/nothing was lost/);
  });
});

describe('Lifetime-vs-Monthly framing', () => {
  it('Day-28 email states Lifetime costs less than 7 months of Monthly', () => {
    const html = lastCallEmailHtml('Jane', 'user-1', SOME);
    expect(html).toMatch(/less than 7 months of Monthly/);
  });

  it('trial-ended email states Lifetime costs less than 7 months of Monthly', () => {
    const html = trialEndedEmailHtml('Jane', 'user-1', SOME);
    expect(html).toMatch(/less than 7 months of Monthly/);
  });

  it('framing never uses the word "savings" to describe the Lifetime/Monthly comparison', () => {
    const html = trialEndedEmailHtml('Jane', 'user-1', SOME);
    const idx = html.indexOf('less than 7 months of Monthly');
    expect(idx).toBeGreaterThan(-1);
    const nearby = html.slice(Math.max(0, idx - 120), idx + 40);
    expect(nearby.toLowerCase()).not.toContain('savings');
  });
});
