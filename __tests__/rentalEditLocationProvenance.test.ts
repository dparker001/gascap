/**
 * PR #58 final hardening — Edit modal location/time-zone provenance
 * (2026-10-02). Selecting a place may set that event's zone ('place');
 * free-typing over it invalidates that selection (back to the STORED zone,
 * never the editing device's); an explicit 'user' zone survives location
 * edits; a stored place zone is not labelled "from the location" once the
 * location text was replaced; a location-text-only edit resets no reminder.
 * Covered for BOTH pickup and return.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'fs';
import path from 'path';
import { translations } from '@/lib/translations';
import {
  zoneOverrideAfterLocationChange, placeProvenanceCurrent, eventZonePayload, type EventZone,
} from '@/components/rental-return/RentalEventScheduleField';
import type { RentalLocationValue } from '@/components/rental-return/RentalLocationInput';

vi.mock('@/contexts/LanguageContext', () => ({ useTranslation: () => ({ t: translations.en, locale: 'en' }) }));

type Row = Record<string, unknown>;
const table = new Map<string, Row>();
let lastCreated: Row | null = null;
vi.mock('@/lib/prisma', () => ({
  prisma: {
    rentalSession: {
      create: vi.fn(async ({ data }: { data: Row }) => { lastCreated = { ...data, refuelLogs: [] }; table.set(data.id as string, lastCreated); return lastCreated; }),
      findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string } }) => {
        const r = table.get(where.id); return r && r.userId === where.userId ? r : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => { const r = table.get(where.id)!; Object.assign(r, data); return r; }),
    },
  },
}));
vi.mock('@/lib/analyticsEvents', () => ({ recordAnalyticsEvent: vi.fn(async () => ({ outcome: 'recorded' })) }));

const place = (text: string, timeZone: string): RentalLocationValue => ({ text, lat: 1, lng: 2, timeZone, timeZoneSource: 'place' });
const typed = (text: string): RentalLocationValue => ({ text, lat: null, lng: null, timeZone: null, timeZoneSource: null });
const STORED: Record<'pickup' | 'return', EventZone> = {
  pickup: { zone: 'America/Los_Angeles', source: 'place' },
  return: { zone: 'America/New_York', source: 'place' },
};

/** Mirrors the Edit modal: effective = override ?? stored. */
function simulate(kind: 'pickup' | 'return', steps: Array<RentalLocationValue | { pick: string }>) {
  let override: EventZone | null = null;
  let loc: RentalLocationValue = typed(kind === 'pickup' ? 'LAX Hertz' : 'JFK Hertz');
  for (const s of steps) {
    if ('pick' in s) override = { zone: s.pick, source: 'user' };
    else { loc = s; override = zoneOverrideAfterLocationChange(override, s); }
  }
  return { override, loc, effective: override ?? STORED[kind] };
}

describe.each(['pickup', 'return'] as const)('%s location provenance (Edit)', (kind) => {
  const storedText = kind === 'pickup' ? 'LAX Hertz' : 'JFK Hertz';

  it('1. selecting a place sets the event zone with source place', () => {
    const { effective } = simulate(kind, [place('Denver Airport', 'America/Denver')]);
    expect(effective).toEqual({ zone: 'America/Denver', source: 'place' });
  });

  it('2. free-typing over that selection drops it: back to the stored zone, and the new text is not shown as the place source', () => {
    const r = simulate(kind, [place('Denver Airport', 'America/Denver'), typed('Denver Airport, east lot')]);
    expect(r.override).toBeNull();
    expect(r.effective).toEqual(STORED[kind]);
    expect(placeProvenanceCurrent(r.effective, r.override, r.loc, storedText)).toBe(false);
    // unchanged stored location still legitimately reads "from the location"
    expect(placeProvenanceCurrent(STORED[kind], null, typed(storedText), storedText)).toBe(true);
    // a fresh selection in this session does too
    const fresh = simulate(kind, [place('Denver Airport', 'America/Denver')]);
    expect(placeProvenanceCurrent(fresh.effective, fresh.override, fresh.loc, storedText)).toBe(true);
  });

  it('3. an explicit user time zone survives free-text location edits', () => {
    const r = simulate(kind, [{ pick: 'America/Chicago' }, typed('Somewhere else'), typed('Somewhere else 2')]);
    expect(r.effective).toEqual({ zone: 'America/Chicago', source: 'user' });
    expect(placeProvenanceCurrent(r.effective, r.override, r.loc, storedText)).toBe(true);
  });

  it('4. no step consults the editing device; the PATCH fragment never carries a device timeZone', () => {
    const r = simulate(kind, [typed('Somewhere new')]);
    expect(r.override).toBeNull();
    expect(eventZonePayload(null, null)).toEqual({});
    const frag = kind === 'pickup' ? eventZonePayload({ zone: 'America/Chicago', source: 'user' }, null) : eventZonePayload(null, { zone: 'America/Chicago', source: 'user' });
    expect(Object.keys(frag)).toEqual(kind === 'pickup' ? ['pickupTimeZone', 'pickupTimeZoneSource'] : ['returnTimeZone', 'returnTimeZoneSource']);
    expect(frag).not.toHaveProperty('timeZone');
  });
});

describe('server: location-text-only edits from a third device', () => {
  beforeEach(() => { table.clear(); lastCreated = null; });
  async function seeded(): Promise<Row> {
    const { createRentalSession } = await import('@/lib/rentalSessions');
    await createRentalSession('u', { rentalCompany: 'Hertz',
      pickupDateTime: '2026-10-05T14:00', pickupTimeZone: 'America/Los_Angeles', pickupTimeZoneSource: 'place', pickupLocation: 'LAX Hertz',
      returnDateTime: '2026-10-08T10:00', returnTimeZone: 'America/New_York', returnTimeZoneSource: 'place', returnLocation: 'JFK Hertz' } as never);
    const row = lastCreated as Row | null as Row;
    Object.assign(row, { pickupReminder24SentAt: 's24', pickupReminder2SentAt: 's2', reminderSentAt: 'sr', returnReminder2SentAt: 'sr2' });
    return row;
  }

  it('4+5. new location text for pickup AND return, PATCHed with a Tokyo device timeZone: zones, instants and every reminder stamp unchanged', async () => {
    const row = await seeded();
    const before = { ...row };
    const { updateRentalSession } = await import('@/lib/rentalSessions');
    const after = (await updateRentalSession('u', row.id as string, {
      timeZone: 'Asia/Tokyo', pickupLocation: 'LAX Hertz, level 2', returnLocation: 'JFK Hertz, terminal 4',
      pickupDateTime: '2026-10-05T14:00', returnDateTime: '2026-10-08T10:00',
    } as never)) as unknown as Row;
    for (const k of ['pickupTimeZone', 'returnTimeZone', 'pickupTimeZoneSource', 'returnTimeZoneSource', 'pickupDateTimeUtc', 'returnDateTimeUtc', 'timeZone',
                     'pickupReminder24SentAt', 'pickupReminder2SentAt', 'reminderSentAt', 'returnReminder2SentAt']) {
      expect([k, after[k]]).toEqual([k, before[k]]);
    }
    expect([after.pickupLocation, after.returnLocation]).toEqual(['LAX Hertz, level 2', 'JFK Hertz, terminal 4']);
  });

  it('5. a newly selected place in a DIFFERENT zone does re-arm only that event\'s reminders', async () => {
    const row = await seeded();
    const { updateRentalSession } = await import('@/lib/rentalSessions');
    const after = (await updateRentalSession('u', row.id as string, {
      returnLocation: 'BOS Hertz', ...eventZonePayload(null, { zone: 'America/Chicago', source: 'place' }),
    } as never)) as unknown as Row;
    expect([after.reminderSentAt, after.returnReminder2SentAt]).toEqual([null, null]);
    expect([after.pickupReminder24SentAt, after.pickupReminder2SentAt]).toEqual(['s24', 's2']);
  });
});

describe('UI', () => {
  const field = async (props: Record<string, unknown>) => {
    const { default: F } = await import('@/components/rental-return/RentalEventScheduleField');
    return renderToString(React.createElement(F, {
      kind: 'return', label: 'Return', dateTime: '2026-10-08T10:00', onDateTime: () => {}, onPickZone: () => {}, onChoice: () => {},
      choice: null, deviceZone: 'America/New_York', zone: STORED.return, ...props,
    } as never));
  };
  it('a stored place zone after the location text changed is labelled as kept, not "from the location"', async () => {
    const html = await field({ placeLabelStale: true });
    expect(html).toContain('kept from your saved rental');
    expect(html).not.toContain('from the location');
    expect(await field({})).toContain('from the location');
  });
  it('the Edit modal wires the helpers for both events (no sticky place override)', () => {
    const src = readFileSync(path.join(process.cwd(), 'components/rental-return/EditRentalModal.tsx'), 'utf8');
    expect(src.match(/zoneOverrideAfterLocationChange\(prev, v\)/g)).toHaveLength(2);
    expect(src.match(/placeLabelStale=\{!placeProvenanceCurrent\(/g)).toHaveLength(2);
    expect(src).not.toMatch(/if \(v\.timeZone\) set(Pickup|Return)ZoneOverride/);
    expect(src).toContain('...eventZonePayload(pickupZoneOverride, returnZoneOverride)');
  });
});
