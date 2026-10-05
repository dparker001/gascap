/**
 * T7 — upcoming-rental pickup reminder notice (2026-10-02). The notice may
 * only claim server reminders the cron will actually still send, only with
 * an authoritative pickupDateTimeUtc, and its push wording must not imply
 * that notification permission alone guarantees delivery.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { pendingPickupReminders, PICKUP_24H_LOWER_HOURS } from '@/lib/rentalReminderNotice';
import { translations } from '@/lib/translations';

const NOW = Date.parse('2026-10-05T00:00:00Z');
const base = { status: 'active', pickupReminder24SentAt: null, pickupReminder2SentAt: null };
const at = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString();
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('pendingPickupReminders', () => {
  it('more than a day ahead → both reminders still scheduled', () => {
    expect(pendingPickupReminders({ ...base, pickupDateTimeUtc: at(48) }, NOW)).toEqual({ day: true, twoHour: true });
  });
  it('saved less than ~20h ahead → only the 2h reminder (the 24h window is already past)', () => {
    expect(pendingPickupReminders({ ...base, pickupDateTimeUtc: at(10) }, NOW)).toEqual({ day: false, twoHour: true });
  });
  it('a tier already sent is no longer claimed; both sent → no notice', () => {
    expect(pendingPickupReminders({ ...base, pickupReminder24SentAt: 'x', pickupDateTimeUtc: at(21) }, NOW)).toEqual({ day: false, twoHour: true });
    expect(pendingPickupReminders({ ...base, pickupReminder24SentAt: 'x', pickupReminder2SentAt: 'y', pickupDateTimeUtc: at(1) }, NOW)).toBeNull();
  });
  it('no authoritative UTC instant, past pickup, or not active → no claim', () => {
    expect(pendingPickupReminders({ ...base, pickupDateTimeUtc: null }, NOW)).toBeNull();
    expect(pendingPickupReminders({ ...base, pickupDateTimeUtc: at(-1) }, NOW)).toBeNull();
    expect(pendingPickupReminders({ ...base, status: 'completed', pickupDateTimeUtc: at(48) }, NOW)).toBeNull();
  });
  it('the 24h threshold matches the cron window', () => {
    expect(read('app/api/cron/rental-return-reminder/route.ts')).toContain(`PICKUP_24H = { lowerHours: ${PICKUP_24H_LOWER_HOURS},`);
  });
});

describe('notice copy (EN + ES)', () => {
  it('names the event zone label and never says permission alone means push', () => {
    for (const loc of ['en', 'es'] as const) {
      const r = translations[loc].rentalReturn;
      expect(r.pickupRemindersBoth('Pacific Time — Los Angeles')).toContain('Pacific Time — Los Angeles');
      expect(r.pickupReminderTwoHour('X')).toContain('(X)');
      expect(r.pickupRemindersDeviceZone.length).toBeGreaterThan(0);
    }
    // Descriptive, not a guaranteed per-rental scheduled job (hourly best-effort cron).
    expect(translations.en.rentalReturn.pickupRemindersBoth('Z')).toBe('Pickup reminders: GasCap sends email reminders about 24 hours and about 2 hours before pickup (Z).');
    expect(translations.en.rentalReturn.pickupReminderTwoHour('Z')).toBe('Pickup reminder: GasCap sends an email reminder about 2 hours before pickup (Z).');
    for (const loc of ['en', 'es'] as const) {
      const r = translations[loc].rentalReturn;
      expect(`${r.pickupRemindersBoth('Z')} ${r.pickupReminderTwoHour('Z')}`).not.toMatch(/scheduled|programad|we'll email|te enviaremos/i);
    }
    expect(translations.en.rentalReturn.pickupRemindersPush).toContain('available and enabled on this device');
    expect(translations.en.rentalReturn.pickupRemindersPush).not.toMatch(/^If notifications are enabled/);
  });
  it('dashboard shows the notice only for upcoming rentals with an authoritative pickup instant', () => {
    const src = read('components/rental-return/RentalDashboard.tsx');
    expect(src).toContain('{isUpcoming && (() => {');
    expect(src).toContain('pendingPickupReminders(session)');
    expect(src).toContain('pickupRemindersDeviceZone');
  });
});

describe('Help + APP FEATURES describe the timezone/reminder behaviour without a local pickup fallback', () => {
  // The rental FAQ lives in lib/helpRentalFaq.ts (owner-approved copy, 2026-10-05).
  const help = read('app/help/page.tsx') + read('lib/helpRentalFaq.ts');
  const ai = read('app/api/ai/chat/route.ts');
  it('help covers per-event zones, DST, channels, and the return-only device fallback', () => {
    expect(help).toContain('How does Rental Mode handle time zones and one-way rentals?');
    expect(help).toContain('What rental reminders will I get?');
    // return-only device fallback; explicitly NO local pickup backup
    expect(help).toContain('There is no local pickup-reminder backup.');
    expect(help).toContain('may schedule a local return reminder if permissions allow');
  });
  it('APP FEATURES states the model and forbids overstated guarantees', () => {
    expect(ai).toContain('Rental Mode time zones + reminders (2026-10-02)');
    expect(ai).toContain('There is NO local pickup reminder.');
    expect(ai).toContain('CAN schedule a local reminder about 2h before RETURN when local notifications are permitted');
    expect(ai).not.toContain('is set on the phone as a fallback');
    expect(ai).not.toMatch(/Time Zone API/);
  });
});
