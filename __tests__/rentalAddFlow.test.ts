/**
 * "+ Add Rental" — one primary button, a two-way chooser, the existing quick-save
 * and full setup flows unchanged, Pro rules preserved, EN/ES strings.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { nextRentalPageMode, effectiveRentalPageMode, type RentalPageMode, type AddRentalAction } from '@/lib/rentalAddFlow';
import { buildQuickSavePayload, quickSaveCanSubmit, type QuickSaveEvent } from '@/lib/rentalQuickSave';
import { getTranslations } from '@/lib/translations';

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');

describe('routing (pure state machine)', () => {
  it('Add Rental → chooser; reservation → quick-save; vehicle → full setup (Pro)', () => {
    expect(nextRentalPageMode('list', 'add', true)).toBe('choose');
    expect(nextRentalPageMode('choose', 'reservation', true)).toBe('quick');
    expect(nextRentalPageMode('choose', 'vehicle', true)).toBe('setup');
  });
  it('back always returns to My Rentals, from every screen', () => {
    for (const m of ['list', 'choose', 'quick', 'setup'] as RentalPageMode[]) {
      expect(nextRentalPageMode(m, 'back', true)).toBe('list');
      expect(nextRentalPageMode(m, 'back', false)).toBe('list');
    }
  });
  it('a path can only be chosen from the chooser (no stray jumps into a flow)', () => {
    expect(nextRentalPageMode('list', 'reservation', true)).toBe('list');
    expect(nextRentalPageMode('list', 'vehicle', true)).toBe('list');
    expect(nextRentalPageMode('quick', 'vehicle', true)).toBe('quick');
    expect(nextRentalPageMode('setup', 'reservation', true)).toBe('setup');
    expect(nextRentalPageMode('choose', 'add', true)).toBe('choose');
  });
  it('PRO: a non-Pro user can never start any flow, whatever the action or current mode', () => {
    for (const m of ['list', 'choose', 'quick', 'setup'] as RentalPageMode[]) {
      for (const a of ['add', 'reservation', 'vehicle'] as AddRentalAction[]) {
        expect(nextRentalPageMode(m, a, false), `${m}/${a}`).toBe('list');
      }
      expect(effectiveRentalPageMode(m, false)).toBe('list');
      expect(effectiveRentalPageMode(m, true)).toBe(m);
    }
  });
});

describe('page wiring (source guards)', () => {
  const page = read('app/rental-return/page.tsx');
  it('ONE primary button replaces the two old creation buttons', () => {
    expect(page.match(/data-testid="add-rental-button"/g)).toHaveLength(1);
    expect(page).toContain('+ {t.rentalReturn.addRental}');
    expect(page).not.toMatch(/t\.rentalReturn\.newRental|t\.rentalReturn\.quickSaveEntry/);
    expect(page).not.toContain('setMode(');
  });
  it('the button is shown only to Pro users; non-Pro still sees the existing upgrade card', () => {
    const btn = page.indexOf('data-testid="add-rental-button"');
    expect(page.lastIndexOf('{isPro && (', btn)).toBeGreaterThan(page.indexOf('Pro gate on STARTING a rental only'));
    expect(page).toContain('{!isPro && (');
    expect(page).toContain('t.rentalReturn.proToStartTitle');
  });
  it('the chooser opens the EXISTING quick-save form and the EXISTING full wizard', () => {
    expect(page).toMatch(/<AddRentalChooser onReservation=\{\(\) => go\('reservation'\)\} onVehicle=\{\(\) => go\('vehicle'\)\} onBack=\{\(\) => go\('back'\)\} \/>/);
    expect(page).toContain('<QuickSaveRentalForm');
    expect(page).toContain('<RentalSetupFlow');
  });
  it('both flows offer a clear way back to My Rentals (link + the form’s own cancel)', () => {
    expect(page.match(/<BackToMyRentals onBack=\{\(\) => go\('back'\)\} \/>/g)).toHaveLength(2);
    expect(page.match(/onCancel=\{\(\) => go\('back'\)\}/g)).toHaveLength(2);
  });
  it('both flows keep creating through the existing path: created rental opens its own page', () => {
    expect(page.match(/router\.push\(`\/rental-return\/\$\{id\}`\)/g)).toHaveLength(2);
    expect(page.match(/trackRentalSessionCreated\(\)/g)).toHaveLength(2);
  });
  it('the existing creation forms and server contract were not edited by this change', () => {
    // Guard the specific lines this change must not alter.
    const quick = read('components/rental-return/QuickSaveRentalForm.tsx');
    expect(quick).toContain('postCreateRental(');
    expect(quick).not.toMatch(/AddRentalChooser|rentalAddFlow/);
    const wizard = read('components/rental-return/RentalSetupFlow.tsx');
    expect(wizard).not.toMatch(/AddRentalChooser|rentalAddFlow/);
  });
});

describe('chooser accessibility (source guards)', () => {
  const c = read('components/rental-return/AddRentalChooser.tsx');
  it('real <button>s with descriptions, a labelled region, a heading, and a labelled back control', () => {
    expect(c.match(/<button\b/g)!.length).toBe(3);                    // two options + back
    expect(c.match(/type="button"/g)!.length).toBe(3);               // never an accidental form submit
    expect(c).not.toMatch(/<div[^>]*onClick/);                      // no clickable divs
    expect(c).toContain('aria-labelledby="add-rental-title"');
    expect(c).toContain('aria-describedby="add-rental-reservation-desc"');
    expect(c).toContain('aria-describedby="add-rental-vehicle-desc"');
    expect(c).toContain('aria-label={t.rentalReturn.addRentalBack}');
    expect(c).toContain('aria-hidden="true"');                       // decorative emoji/icons hidden
  });
  it('mobile-first: full-width tap targets, no fixed desktop widths', () => {
    expect(c).toContain('w-full');
    expect(c).toContain('max-w-lg');
    expect(c).not.toMatch(/\bw-\[\d+px\]|min-w-\[/);
  });
});

describe('Option A — a future reservation needs NO vehicle or fuel information', () => {
  const ev = (over: Partial<QuickSaveEvent> = {}): QuickSaveEvent => ({
    dateTime: '2026-10-20T09:00',
    location: { text: 'MCO', lat: null, lng: null } as QuickSaveEvent['location'],
    zone: { zone: 'America/New_York', source: 'user' } as QuickSaveEvent['zone'],
    status: { kind: 'valid' } as QuickSaveEvent['status'],
    choice: null, ...over,
  });
  const input = { company: 'Hertz', confirmationNumber: '', pickup: ev(), ret: ev({ dateTime: '2026-10-23T09:00' }), deviceZone: 'America/New_York' };

  it('the payload carries the reservation only — never a vehicle, tank, fuel or rate field', () => {
    const body = buildQuickSavePayload(input) as Record<string, unknown>;
    for (const k of Object.keys(body)) {
      expect(k, k).not.toMatch(/vehicle|vin|tank|fuel|rate|gallon|photo/i);
    }
    expect(body.rentalCompany).toBe('Hertz');
    expect(body.pickupDateTime).toBe('2026-10-20T09:00');
    expect(body.returnDateTime).toBe('2026-10-23T09:00');
  });
  it('requires the company and BOTH times with a valid zone; confirmation number and locations are optional', () => {
    expect(quickSaveCanSubmit({ company: 'Hertz', pickup: ev(), ret: ev() })).toBe(true);
    expect(quickSaveCanSubmit({ company: '', pickup: ev(), ret: ev() })).toBe(false);
    expect(quickSaveCanSubmit({ company: 'Hertz', pickup: ev({ dateTime: '' }), ret: ev() })).toBe(false);
    expect(quickSaveCanSubmit({ company: 'Hertz', pickup: ev(), ret: ev({ dateTime: '' }) })).toBe(false);
    expect(quickSaveCanSubmit({ company: 'Hertz', pickup: ev({ status: { kind: 'nonexistent' } as QuickSaveEvent['status'] }), ret: ev() })).toBe(false);
    expect(quickSaveCanSubmit({ company: 'Hertz', pickup: ev({ location: { text: '', lat: null, lng: null } as QuickSaveEvent['location'] }), ret: ev({ location: { text: '', lat: null, lng: null } as QuickSaveEvent['location'] }) })).toBe(true);
  });
  it('the form keeps its duplicate protection (clientRentalId, bound warning) and never asks for vehicle/fuel', () => {
    const f = read('components/rental-return/QuickSaveRentalForm.tsx');
    expect(f).toContain('newClientRentalId()');
    expect(f).toContain('mayConfirmDuplicate(');
    expect(f).not.toMatch(/RentalVehicleLookup|RentalVinLookup|tankCapacity|pickupFuel|FuelLevelInput/);
  });
});

describe('Option B — the existing full setup is unchanged', () => {
  it('still the multi-step wizard with its vehicle / fuel validation', () => {
    const w = read('components/rental-return/RentalSetupFlow.tsx');
    expect(w).toContain('RentalVehicleLookup');
    expect(w).toContain('canNext2');
    expect(w).toContain('resolvePickupFuel');
    expect(w).toContain('postCreateRental(');
  });
});

describe('English and Spanish strings', () => {
  const en = getTranslations('en').rentalReturn;
  const es = getTranslations('es').rentalReturn;
  const keys = ['addRental', 'addRentalChooseTitle', 'addRentalReservationTitle', 'addRentalReservationBody', 'addRentalVehicleTitle', 'addRentalVehicleBody', 'addRentalBack'] as const;
  it('every new string exists in both languages and Spanish is genuinely translated', () => {
    for (const k of keys) {
      expect(en[k], `en.${k}`).toBeTruthy();
      expect(es[k], `es.${k}`).toBeTruthy();
      expect(es[k], `es.${k} differs from en`).not.toBe(en[k]);
    }
  });
  it('English matches the approved wording exactly', () => {
    expect(en.addRental).toBe('Add Rental');
    expect(en.addRentalReservationTitle).toBe('I have a future reservation');
    expect(en.addRentalReservationBody).toBe('Save your reservation now. Add your vehicle and fuel details when you pick it up.');
    expect(en.addRentalVehicleTitle).toBe('I have the rental vehicle');
    expect(en.addRentalVehicleBody).toBe('Set up your rental using your vehicle and fuel information.');
  });
});

describe('scope', () => {
  it('no schema, API route, notification, native or protected-path file is part of this change', () => {
    expect(read('prisma/schema.prisma')).not.toContain('addRental');
    expect(read('app/api/rental-sessions/route.ts')).not.toMatch(/AddRental|rentalAddFlow/);
    expect(read('capacitor.config.json')).not.toMatch(/AddRental/);
  });
});
