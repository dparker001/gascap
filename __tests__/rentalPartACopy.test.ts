/**
 * Part A / A6 (2026-10-02) copy fixes found in the PR #58 production smoke
 * test: an open rental's details said "Picked Up / Returned"; the zone
 * difference line said "3 hours behind of your current time zone".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { translations } from '@/lib/translations';

const dash = readFileSync(path.join(process.cwd(), 'components/rental-return/RentalDashboard.tsx'), 'utf8');

describe('open-rental detail labels', () => {
  it('EN/ES schedule wording exists', () => {
    expect([translations.en.rentalReturn.detailPickupLabel, translations.en.rentalReturn.detailReturnLabel]).toEqual(['Pickup', 'Return']);
    expect([translations.es.rentalReturn.detailPickupLabel, translations.es.rentalReturn.detailReturnLabel]).toEqual(['Recogida', 'Devolución']);
  });
  it('the open-rental Rental Details section uses it; the completed view keeps the past tense', () => {
    const start = dash.lastIndexOf('rentalConfirmationNumber && (');   // the open-rental details block
    const open = dash.slice(start, dash.indexOf('returnLocationLabel}</span>', start));
    expect(open).toContain('t.rentalReturn.detailPickupLabel');
    expect(open).toContain('t.rentalReturn.detailReturnLabel');
    expect(open).not.toContain('completedPickupLabel');
    expect(dash.match(/t\.rentalReturn\.completedPickupLabel/g)?.length).toBe(1);
  });
});

describe('time-zone difference grammar', () => {
  it('EN: "behind your" / "ahead of your" — never "behind of"', () => {
    const f = translations.en.rentalReturn.tzDiffers;
    expect(f('return', 'Pacific Time', '3', 'behind')).toBe('Your return is in Pacific Time — 3 hours behind your current time zone.');
    expect(f('pickup', 'Eastern Time', '1', 'ahead')).toBe('Your pickup is in Eastern Time — 1 hour ahead of your current time zone.');
  });
  it('ES unchanged and correct', () => {
    expect(translations.es.rentalReturn.tzDiffers('devolución', 'hora del Pacífico', '3', 'behind'))
      .toBe('Tu devolución es en hora del Pacífico — 3 horas menos que tu zona horaria actual.');
  });
});

describe('Help + APP FEATURES describe Part A without overstating', () => {
  const help = readFileSync(path.join(process.cwd(), 'app/help/page.tsx'), 'utf8');
  const ai = readFileSync(path.join(process.cwd(), 'app/api/ai/chat/route.ts'), 'utf8');
  it('help explains quick-save, the setup order and the no-guess rules', () => {
    expect(help).toContain('Can I save a rental I booked ahead before I know the car or fuel level?');
    expect(help).toContain('doesn\\u2019t invent a level from it');
  });
  it('APP FEATURES covers it and says email import is NOT available yet', () => {
    expect(ai).toContain('Rental Mode quick-save + finish at the counter (Part A)');
    expect(ai).toContain('Do not claim GasCap imports bookings from email yet');
  });
});

describe('review fix — a refused tank size is explained, and the refuel note mentions exact gallons', () => {
  it('Edit modal maps fuel_reading_exceeds_tank_capacity to a specific EN/ES message (never the raw code)', () => {
    const m = readFileSync(path.join(process.cwd(), 'components/rental-return/EditRentalModal.tsx'), 'utf8');
    expect(m).toContain("data.error === 'fuel_reading_exceeds_tank_capacity' ? t.rentalReturn.tankSmallerThanReading");
    expect(translations.en.rentalReturn.tankSmallerThanReading).toMatch(/smaller than a fuel amount/);
    expect(translations.es.rentalReturn.tankSmallerThanReading).toMatch(/menor que una cantidad/);
  });
  it('refuel-unknown note acknowledges exact gallons (EN/ES)', () => {
    expect(translations.en.rentalReturn.refuelLoggedLevelUnknown).toContain('or enter the exact gallons');
    expect(translations.es.rentalReturn.refuelLoggedLevelUnknown).toContain('o ingresa los galones exactos');
  });
});

