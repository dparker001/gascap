/** Rental Help FAQ — owner-approved copy applied verbatim, rendered safely. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { RENTAL_FAQ, RENTAL_FAQ_AUTO_OPEN, parseHelpAnswer } from '@/lib/helpRentalFaq';

// The owner's copy (2026-10-05), independently written out for the verbatim guard.
const APPROVED: Array<{ q: string; paragraphs: string[] }> = [
  { q: 'What is Rental Car Mode?', paragraphs: [
    'Rental Car Mode helps you manage rentals separately from your personal vehicles. Tap the **Rental Car Mode** banner or go to **Tools → Trip → Rental Return** to view upcoming, active, and past rentals. Your regular fuel calculator remains available.',
    'Starting a rental requires Pro or an active Pro trial, but existing rentals remain usable if Pro expires. For electric rentals, use **EV Charge → Rental Mode** to calculate the charge level, electricity, cost, and charging time needed before return.',
  ] },
  { q: 'What is the Rental Return Assistant?', paragraphs: [
    'The Rental Return Assistant, found under **My Rentals**, helps you avoid unnecessary rental-company refueling charges.',
    'Enter your rental details, vehicle, pickup fuel level, required return level, and return location and time. Before calculating fuel needs, GasCap™ asks you to confirm or update your last-reported fuel reading. Manual gauge readings and fuel calculations are estimates, not exact measurements.',
    'GasCap™ then estimates how many gallons to add, the cost, potential savings, and possible rental-company refueling charges. You can find stations near your return location, track multiple fill-ups, and update your rental details.',
    'You can also scan an agreement to prefill information (Pro feature), save pickup and return photos, and document possible fuel-fee disputes. Photos are available on every plan and are compressed within storage limits.',
    'When you complete a rental, its history preserves fuel records, costs, photos, notes, and any reported fees. Deleting a rental permanently removes its associated fuel records and photos.',
    'Existing rentals remain accessible if Pro expires, including Find Gas Near Return until 24 hours after the scheduled return time.',
  ] },
  { q: 'How does Rental Mode handle time zones and one-way rentals?', paragraphs: [
    "Pickup and return locations can have different time zones. GasCap™ uses each location's local time when available, making one-way rentals across time zones easy to manage.",
    'The app shows the selected time zone and whether it came from your location, your selection, or your device. You can correct an assumed zone before saving.',
    'Saved times remain accurate when you travel between time zones. GasCap™ also detects daylight-saving conflicts, asking you to correct nonexistent times or choose between repeated times.',
  ] },
  { q: 'Can I save a rental I booked ahead before I know the car or fuel level?', paragraphs: [
    'Yes! Open **My Rentals → Booked ahead? Save it as upcoming**. Enter the rental company, pickup and return locations and times, and an optional confirmation number. A pickup time is required.',
    'When collecting the vehicle, use **Finish setup** to add the vehicle, tank capacity, and actual pickup fuel level.',
    'Until that information is available, GasCap™ keeps fuel quantities unknown and disables calculations rather than guessing. Gauge and percentage inputs require a known tank capacity. You can still log a fill-up, but you must provide a reading before calculating remaining fuel.',
    'Saving an upcoming rental requires Pro or an active Pro trial.',
  ] },
  { q: 'How does Rental Mode know where my rental stands?', paragraphs: [
    "GasCap™ uses your saved pickup and return times to identify each rental's stage.",
    "Around pickup (3 hours before through 6 hours after), it prompts you to finish any missing setup. After the return deadline, it asks whether you've returned the vehicle. After another 72 hours, unresolved rentals move to **Needs your attention**.",
    'You can complete, cancel, update, or delete rentals yourself. GasCap™ never makes those decisions automatically. Invalid schedules require correction, and possible duplicate bookings trigger a confirmation.',
  ] },
  { q: 'What rental reminders will I get?', paragraphs: [
    'GasCap™ sends rental reminders by email and, when enabled, push notifications.',
    'For upcoming rentals, reminders are scheduled approximately **24 hours and 2 hours before pickup**. The 24-hour reminder applies only when the booking was saved sufficiently early.',
    "Before returning the vehicle, you'll receive a fuel-check reminder and another reminder approximately 2 hours before return.",
    'Supported iPhone and Android devices without usable push notifications may schedule a local return reminder if permissions allow. There is no local pickup-reminder backup. Multiple devices may receive their own alerts.',
    'Delivery depends on your notification settings and connectivity, so always verify your scheduled return time.',
  ] },
];

describe('verbatim copy', () => {
  const owned = RENTAL_FAQ.filter((f) => f.q !== RENTAL_FAQ_AUTO_OPEN.q);
  it('the six approved entries appear in the approved order, question and answer text unchanged', () => {
    expect(owned.map((f) => f.q)).toEqual(APPROVED.map((x) => x.q));
    owned.forEach((f, i) => expect(f.a, f.q).toBe(APPROVED[i].paragraphs.join('\n\n')));
  });
  it('the product-authored auto-open entry sits between "stands" and "reminders" and is not part of the approved copy', () => {
    const qs = RENTAL_FAQ.map((f) => f.q);
    expect(qs.indexOf(RENTAL_FAQ_AUTO_OPEN.q)).toBe(qs.indexOf('How does Rental Mode know where my rental stands?') + 1);
    expect(qs.indexOf('What rental reminders will I get?')).toBe(qs.indexOf(RENTAL_FAQ_AUTO_OPEN.q) + 1);
    expect(RENTAL_FAQ_AUTO_OPEN.a).toContain('device and your account');
  });
  it('questions are unique and the old inline rental entries are gone from the page', () => {
    expect(new Set(RENTAL_FAQ.map((f) => f.q)).size).toBe(RENTAL_FAQ.length);
    const page = readFileSync(path.join(process.cwd(), 'app/help/page.tsx'), 'utf8');
    expect(page).toContain('...RENTAL_FAQ,');
    for (const old of ["q: 'What is Rental Car Mode?'", "q: 'What is the Rental Return Assistant?'", "q: 'What rental reminders will I get?'", "q: 'How does Rental Mode know where my rental stands?'"]) {
      expect(page).not.toContain(old);
    }
  });
});

describe('parseHelpAnswer (safe rendering model)', () => {
  it('splits paragraphs on blank lines and marks **bold** spans', () => {
    expect(parseHelpAnswer('One **two** three.\n\nSecond.')).toEqual([
      [{ text: 'One ', bold: false }, { text: 'two', bold: true }, { text: ' three.', bold: false }],
      [{ text: 'Second.', bold: false }],
    ]);
  });
  it('arrows and ™ survive inside bold spans', () => {
    expect(parseHelpAnswer('Go to **Tools → Trip → Rental Return** now')[0][1]).toEqual({ text: 'Tools → Trip → Rental Return', bold: true });
  });
  it('an answer with neither (every pre-existing Help entry) is one plain paragraph, unchanged', () => {
    expect(parseHelpAnswer('Just text, with an it’s and “quotes”.')).toEqual([[{ text: 'Just text, with an it’s and “quotes”.', bold: false }]]);
  });
  it('HTML in an answer stays text — it is never interpreted', () => {
    const segs = parseHelpAnswer('Hello <script>alert(1)</script> **<b>x</b>**').flat();
    expect(segs.map((s) => s.text).join('')).toBe('Hello <script>alert(1)</script> <b>x</b>');
    const page = readFileSync(path.join(process.cwd(), 'app/help/page.tsx'), 'utf8');
    expect(page).not.toMatch(/dangerouslySetInnerHTML/);
  });
  it('an unmatched ** is left as literal text, and blank input yields no paragraphs', () => {
    expect(parseHelpAnswer('a ** b')[0].map((s) => s.text).join('')).toBe('a ** b');
    expect(parseHelpAnswer('  \n\n  ')).toEqual([]);
  });
  it('every approved entry parses into the approved paragraph count', () => {
    RENTAL_FAQ.filter((f) => f.q !== RENTAL_FAQ_AUTO_OPEN.q).forEach((f, i) => expect(parseHelpAnswer(f.a)).toHaveLength(APPROVED[i].paragraphs.length));
  });
});
