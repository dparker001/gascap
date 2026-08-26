/**
 * Phase 5C — EN/ES parity for the feedback invite/reminder/push copy.
 * lib/translations.ts already enforces full key parity at compile time
 * (`const es: typeof en`); this guards against an empty-string value and
 * confirms the interpolation functions (heading/drawing-line/push-body)
 * actually produce non-empty, distinct output per locale.
 */
import { describe, it, expect } from 'vitest';
import { getTranslations } from '@/lib/translations';

describe('feedbackCampaignEmail translations', () => {
  it.each(['en', 'es'] as const)('%s has no empty feedbackCampaignEmail string values', (locale) => {
    const t = getTranslations(locale).feedbackCampaignEmail;
    for (const [key, value] of Object.entries(t)) {
      if (typeof value === 'string') expect(value.trim(), `${locale}.feedbackCampaignEmail.${key}`).not.toBe('');
    }
  });

  it.each(['en', 'es'] as const)('%s interpolates name/date into the invite/reminder/push copy', (locale) => {
    const t = getTranslations(locale).feedbackCampaignEmail;
    expect(t.inviteHeading('Alex')).toContain('Alex');
    expect(t.inviteDrawingLine('September 30')).toContain('September 30');
    expect(t.reminderDrawingLine('September 30')).toContain('September 30');
    expect(t.pushBody('September 30')).toContain('September 30');
  });

  it('EN and ES produce different text for the same inputs', () => {
    const en = getTranslations('en').feedbackCampaignEmail;
    const es = getTranslations('es').feedbackCampaignEmail;
    expect(en.inviteSubject).not.toBe(es.inviteSubject);
    expect(en.reminderSubject).not.toBe(es.reminderSubject);
    expect(en.pushTitle).not.toBe(es.pushTitle);
  });
});
