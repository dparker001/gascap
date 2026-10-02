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
