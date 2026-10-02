/**
 * T4 — setup/edit timezone UX (2026-10-02). Pure helpers + server-rendered
 * RentalEventScheduleField states + static guarantees on the edit form.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'fs';
import path from 'path';
import { translations } from '@/lib/translations';
import { describeEventTime, formatEventWallClock, zoneLongName } from '@/lib/rentalTimezone';

vi.mock('@/contexts/LanguageContext', () => ({ useTranslation: () => ({ t: translations.en, locale: 'en' }) }));

const field = async (props: Record<string, unknown>) => {
  const { default: F } = await import('@/components/rental-return/RentalEventScheduleField');
  return renderToString(React.createElement(F, {
    kind: 'return', label: 'Return', onDateTime: () => {}, onPickZone: () => {}, onChoice: () => {},
    choice: null, deviceZone: 'America/New_York', ...props,
  } as never));
};

describe('effective zone precedence (place > user > device)', () => {
  it('place wins, then a user pick, then the device assumption', async () => {
    const { effectiveEventZone } = await import('@/components/rental-return/RentalEventScheduleField');
    const place = { text: 'LAX', lat: 1, lng: 2, timeZone: 'America/Los_Angeles', timeZoneSource: 'place' as const };
    const text = { text: 'somewhere', lat: null, lng: null, timeZone: null, timeZoneSource: null };
    expect(effectiveEventZone(place, { zone: 'America/Denver', source: 'user' }, 'America/New_York')).toEqual({ zone: 'America/Los_Angeles', source: 'place' });
    expect(effectiveEventZone(text, { zone: 'America/Denver', source: 'user' }, 'America/New_York')).toEqual({ zone: 'America/Denver', source: 'user' });
    expect(effectiveEventZone(text, null, 'America/New_York')).toEqual({ zone: 'America/New_York', source: 'device' });
    expect(effectiveEventZone(text, null, null)).toEqual({ zone: null, source: null });
  });
  it('a nonexistent time blocks submit; ambiguous and valid do not', async () => {
    const { eventTimeSubmittable } = await import('@/components/rental-return/RentalEventScheduleField');
    expect(eventTimeSubmittable(describeEventTime('2027-03-14T02:30', 'America/New_York'))).toBe(false);
    expect(eventTimeSubmittable(describeEventTime('2026-11-01T01:30', 'America/New_York'))).toBe(true);
    expect(eventTimeSubmittable(describeEventTime('2026-10-05T14:00', 'America/Los_Angeles'))).toBe(true);
  });
});

describe('RentalEventScheduleField rendering', () => {
  it('shows "Pacific Time — Los Angeles" (no raw IANA id) and the place source', async () => {
    const html = await field({ dateTime: '2026-10-05T14:00', zone: { zone: 'America/Los_Angeles', source: 'place' } });
    expect(html).toContain('Pacific Time');
    expect(html).toContain('Los Angeles');
    expect(html).toContain('from the location');
    expect(html).not.toContain('America/Los_Angeles');
  });
  it('labels a device-derived zone as an assumption', async () => {
    const html = await field({ dateTime: '2026-10-05T14:00', zone: { zone: 'America/New_York', source: 'device' } });
    expect(html).toContain('assumed from your device');
  });
  it('explains a cross-zone difference ("3 hours behind your current time zone")', async () => {
    const html = await field({ kind: 'pickup', dateTime: '2026-10-05T14:00', zone: { zone: 'America/Los_Angeles', source: 'place' } });
    expect(html).toContain('Your pickup is in Pacific Time');
    expect(html).toContain('3 hours behind');
  });
  it('a spring-forward gap time renders a blocking explanation', async () => {
    const html = await field({ dateTime: '2027-03-14T02:30', zone: { zone: 'America/New_York', source: 'place' } });
    expect(html).toContain('doesn&#x27;t exist on');
    expect(html).toContain('role="alert"');
  });
  it('a fall-back repeated time shows BOTH occurrences with their abbreviations', async () => {
    const html = await field({ dateTime: '2026-11-01T01:30', zone: { zone: 'America/New_York', source: 'place' } });
    expect(html).toContain('occurs twice on');
    expect(html).toContain('First 1:30 AM (EDT)');
    expect(html).toContain('Second 1:30 AM (EST)');
    expect((html.match(/type="radio"/g) ?? []).length).toBe(2);
  });
  it('no zone at all prompts the user to pick a location or a time zone', async () => {
    const html = await field({ dateTime: '2026-10-05T14:00', zone: { zone: null, source: null }, deviceZone: null });
    expect(html).toContain('choose a time zone');
  });
});

describe('display formatting in the EVENT zone', () => {
  it('shows the stored occurrence for an ambiguous time and never the viewer zone', () => {
    expect(formatEventWallClock('2026-11-01T01:30', 'America/New_York', '2026-11-01T06:30:00.000Z', 'en-US')).toBe('Nov 1, 1:30 AM EST');
    expect(formatEventWallClock('2026-10-05T14:00', 'America/Los_Angeles', '2026-10-05T21:00:00.000Z', 'en-US')).toBe('Oct 5, 2:00 PM PDT');
    expect(zoneLongName('America/New_York', Date.parse('2026-10-05T12:00:00Z'))).toBe('Eastern Time');
  });
  it('legacy wall clock without a zone/instant is shown unshifted', () => {
    const prev = process.env.TZ; process.env.TZ = 'Asia/Tokyo';
    try { expect(formatEventWallClock('2026-10-05T14:00', null, null, 'en-US')).toBe('Oct 5, 2:00 PM'); }
    finally { process.env.TZ = prev; }
  });
});

describe('edit form never sends the device timezone', () => {
  const src = readFileSync(path.resolve(__dirname, '../components/rental-return/EditRentalModal.tsx'), 'utf8');
  it('no legacy timeZone field in the PATCH body', () => {
    const body = src.slice(src.indexOf('body: JSON.stringify({'), src.indexOf('}),', src.indexOf('body: JSON.stringify({')));
    expect(body).not.toMatch(/\btimeZone:/);
    // Zones go only through eventZonePayload (changed zones only; it never
    // emits timeZone — asserted in rentalEditLocationProvenance.test.ts).
    expect(body).toContain('...eventZonePayload(pickupZoneOverride, returnZoneOverride)');
  });
  it('setup flow sends each event zone and disambiguation explicitly', () => {
    const setup = readFileSync(path.resolve(__dirname, '../components/rental-return/RentalSetupFlow.tsx'), 'utf8');
    for (const k of ['pickupTimeZone:', 'returnTimeZone:', 'pickupTimeDisambiguation:', 'returnTimeDisambiguation:', 'pickupLatitude:']) {
      expect(setup).toContain(k);
    }
  });
});
