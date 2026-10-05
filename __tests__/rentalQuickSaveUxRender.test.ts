/**
 * Quick-save UX refinements — rendered markup (server render; no DOM/jsdom is
 * available in this repo): labels and empty-state guidance in EN and ES, the
 * "Same as pickup location" checkbox, the Edit Rental close button, and the
 * guarantee that shared components are unchanged when the new props are absent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'fs';
import path from 'path';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'es' }));
vi.mock('@/contexts/LanguageContext', async () => {
  const { getTranslations } = await import('@/lib/translations');
  return { useTranslation: () => ({ t: getTranslations(state.locale), locale: state.locale, toggle() {}, setLocale() {} }) };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, replace() {}, back() {} }) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null, status: 'unauthenticated' }) }));

import DateTimeSplitInput from '@/components/rental-return/DateTimeSplitInput';
import RentalEventScheduleField from '@/components/rental-return/RentalEventScheduleField';
import QuickSaveRentalForm from '@/components/rental-return/QuickSaveRentalForm';
import EditRentalModal from '@/components/rental-return/EditRentalModal';
import { emptyRentalLocation } from '@/components/rental-return/RentalLocationInput';
import { getTranslations } from '@/lib/translations';
import type { RentalSession } from '@/lib/rentalSessions';

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');
const text = (loc: 'en' | 'es') => {
  const r = getTranslations(loc).rentalReturn;
  return { dateLabel: r.pickupDateFieldLabel, timeLabel: r.pickupTimeFieldLabel, dateEmptyHint: r.dateEmptyHint, timeEmptyHint: r.timeEmptyHint };
};
beforeEach(() => { state.locale = 'en'; });

describe('1. labels and empty-state guidance — DateTimeSplitInput', () => {
  it('EN: a visible <label for> per input, matched to the input id, with "Choose a date / time" while empty', () => {
    const html = renderToStaticMarkup(h(DateTimeSplitInput, { value: '', onChange() {}, text: text('en') }));
    const date = /<label for="([^"]+)"[^>]*>Pickup Date<\/label>/.exec(html);
    const time = /<label for="([^"]+)"[^>]*>Pickup Time<\/label>/.exec(html);
    expect(date).toBeTruthy(); expect(time).toBeTruthy();
    expect(html).toContain(`id="${date![1]}" type="date"`.replace('id="', 'id="')) ;
    expect(html).toMatch(new RegExp(`<input id="${date![1].replace(/[:]/g, '\\:')}"[^>]*type="date"`));
    expect(html).toMatch(new RegExp(`<input id="${time![1].replace(/[:]/g, '\\:')}"[^>]*type="time"`));
    expect(html).toContain('Choose a date');
    expect(html).toContain('Choose a time');
  });
  it('the guidance is a real element tied to the input with aria-describedby (not a placeholder attribute)', () => {
    const html = renderToStaticMarkup(h(DateTimeSplitInput, { value: '', onChange() {}, text: text('en') }));
    const described = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((m) => m[1]);
    expect(described).toHaveLength(2);
    for (const id of described) expect(html).toContain(`<p id="${id}"`);
    expect(html).not.toContain('placeholder=');
  });
  it('once filled, the hint echoes the chosen value in words (iOS shows a blank native control)', () => {
    const html = renderToStaticMarkup(h(DateTimeSplitInput, { value: '2026-10-20T10:00', onChange() {}, text: text('en') }));
    expect(html).toContain('Tue, Oct 20, 2026');
    expect(html).toContain('10:00 AM');
    expect(html).not.toContain('Choose a date');
  });
  it('a time that is still the automatic default says so', () => {
    const t = { ...text('en'), timeDefaultedNote: getTranslations('en').rentalReturn.returnTimeDefaultNote };
    const html = renderToStaticMarkup(h(DateTimeSplitInput, { value: '2026-10-24T10:00', onChange() {}, text: t, defaultTime: '10:00' }));
    expect(html).toContain('same as your pickup time');
    const own = renderToStaticMarkup(h(DateTimeSplitInput, { value: '2026-10-24T15:00', onChange() {}, text: t, defaultTime: '10:00' }));
    expect(own).not.toContain('same as your pickup time');
  });
  it('ES: Spanish labels, hints and formatted values', () => {
    state.locale = 'es';
    const html = renderToStaticMarkup(h(DateTimeSplitInput, { value: '', onChange() {}, text: text('es') }));
    expect(html).toContain('Fecha de recogida');
    expect(html).toContain('Hora de recogida');
    expect(html).toContain('Elige una fecha');
    expect(html).toContain('Elige una hora');
    const filled = renderToStaticMarkup(h(DateTimeSplitInput, { value: '2026-10-20T10:00', onChange() {}, text: text('es') }));
    expect(filled).toMatch(/oct/i);
  });
  it('the partial entry is preserved: an initial time-only draft renders the time without a date', () => {
    const html = renderToStaticMarkup(h(DateTimeSplitInput, { value: '', onChange() {}, text: text('en'), defaultTime: '10:00' }));
    expect(html).toMatch(/<input[^>]*type="time"[^>]*value="10:00"/);
    expect(html).toMatch(/<input[^>]*type="date"[^>]*value=""/);
    expect(html).toContain('Choose a date');       // the date is NOT auto-populated
  });
});

describe('shared component unchanged when the new props are absent (no layout change for other forms)', () => {
  it('no labels, no hint paragraphs — exactly the two inputs in the same grid', () => {
    const html = renderToStaticMarkup(h(DateTimeSplitInput, { value: '2026-10-20T10:00', onChange() {} }));
    expect(html).not.toContain('<label');
    expect(html).not.toContain('<p');
    expect(html.match(/<input/g)).toHaveLength(2);
    expect(html).toContain('grid grid-cols-1 sm:grid-cols-2 gap-2');
    expect(html).toContain('class="rental-datetime-input min-w-0"');
  });
  it('RentalEventScheduleField without sameAs/zoneLocked/dateTimeText keeps the location input and the zone Change control', () => {
    const html = renderToStaticMarkup(h(RentalEventScheduleField, {
      kind: 'pickup', label: 'Pickup', dateTime: '2026-10-20T10:00', onDateTime() {}, location: emptyRentalLocation(), onLocation() {},
      locationLabel: 'Pickup location', zone: { zone: 'America/New_York', source: 'user' }, onPickZone() {}, choice: null, onChoice() {}, deviceZone: 'America/New_York',
    }));
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain('data-rental-location="pickup"');
    expect(html).toContain(getTranslations('en').rentalReturn.tzChange);
    expect(html).not.toContain('Pickup Date');
  });
  it('the wizard and the Edit modal do not opt in to labels or defaults', () => {
    for (const f of ['components/rental-return/RentalSetupFlow.tsx', 'components/rental-return/EditRentalModal.tsx']) {
      expect(read(f)).not.toMatch(/dateTimeText|defaultTime|onDateTimeParts|sameAs=/);
    }
  });
});

describe('2. Same as pickup location — return section', () => {
  const field = (checked: boolean, zoneLocked = checked) => renderToStaticMarkup(h(RentalEventScheduleField, {
    kind: 'return', label: 'Return', dateTime: '', onDateTime() {}, location: emptyRentalLocation(), onLocation() {},
    locationLabel: 'Return location', zone: { zone: 'America/New_York', source: 'place' }, onPickZone() {}, choice: null, onChoice() {}, deviceZone: 'America/New_York',
    sameAs: { checked, onChange() {}, label: 'Same as pickup location', summary: 'Using your pickup location: MCO', emptySummary: 'Will use your pickup location once you add it' },
    zoneLocked,
  }));
  it('the checkbox sits directly under the "Return location" label, before the location input and the date/time', () => {
    const html = field(false);
    const iLabel = html.indexOf('Return location'), iBox = html.indexOf('type="checkbox"'), iInput = html.indexOf('data-rental-location="return"'), iDate = html.indexOf('type="date"');
    expect(iLabel).toBeGreaterThan(-1);
    expect(iBox).toBeGreaterThan(iLabel);
    expect(iInput).toBeGreaterThan(iBox);
    expect(iDate).toBeGreaterThan(iInput);
    expect(html).toContain('Same as pickup location');
  });
  it('checked: a read-only summary replaces the input, and the zone picker is hidden (the zone follows the pickup)', () => {
    const html = field(true);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
    expect(html).toContain('Using your pickup location: MCO');
    expect(html).not.toContain('data-rental-location="return"');
    expect(html).not.toContain(getTranslations('en').rentalReturn.tzChange);
  });
  it('unchecked: the independent location input is back, with the zone Change control (one-way rentals)', () => {
    const html = field(false);
    expect(html).not.toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
    expect(html).toContain('data-rental-location="return"');
    expect(html).toContain(getTranslations('en').rentalReturn.tzChange);
  });
});

describe('2b. locked zone with NO zone determined — no unusable Change button', () => {
  const noZone = { zone: null, source: null } as { zone: string | null; source: null };
  const field = (zoneLocked: boolean, sameAsChecked = zoneLocked) => renderToStaticMarkup(h(RentalEventScheduleField, {
    kind: 'return', label: 'Return', dateTime: '', onDateTime() {}, location: emptyRentalLocation(), onLocation() {},
    locationLabel: 'Return location', zone: noZone, onPickZone() {}, choice: null, onChoice() {}, deviceZone: null,
    sameAs: { checked: sameAsChecked, onChange() {}, label: 'Same as pickup location', summary: '', emptySummary: 'Will use your pickup location once you add it' },
    zoneLocked,
  }));
  it('EN: shows the explanation, and NO Change button or picker', () => {
    const html = field(true);
    const en = getTranslations('en').rentalReturn;
    expect(html).toContain('data-testid="zone-locked-needs-pickup-zone"');
    expect(html).toContain('The return uses your pickup time zone');
    expect(html).toContain('uncheck');
    expect(html).not.toContain(`>${en.tzChange}</button>`);
    expect(html).not.toContain('<select');
    expect(html).not.toContain(en.tzNeedsZone);                       // not the generic "pick a time zone" text
  });
  it('ES: the same explanation in Spanish', () => {
    state.locale = 'es';
    const html = field(true);
    const es = getTranslations('es').rentalReturn;
    expect(html).toContain('La devoluci\u00f3n usa la zona horaria de recogida');
    expect(html).toContain('desmarca');
    expect(html).not.toContain(`>${es.tzChange}</button>`);
  });
  it('ONE-WAY rentals keep working: unchecked (zone not locked) still offers the Change control', () => {
    const html = field(false, false);
    const en = getTranslations('en').rentalReturn;
    expect(html).toContain(`>${en.tzChange}</button>`);
    expect(html).toContain(en.tzNeedsZone);
    expect(html).not.toContain('zone-locked-needs-pickup-zone');
  });
  it('a locked event whose zone IS known is unchanged: it shows the zone line without a Change button', () => {
    const html = renderToStaticMarkup(h(RentalEventScheduleField, {
      kind: 'return', label: 'Return', dateTime: '', onDateTime() {}, location: emptyRentalLocation(), onLocation() {},
      locationLabel: 'Return location', zone: { zone: 'America/New_York', source: 'place' }, onPickZone() {}, choice: null, onChoice() {}, deviceZone: 'America/New_York',
      sameAs: { checked: true, onChange() {}, label: 'Same as pickup location', summary: 'MCO', emptySummary: '' }, zoneLocked: true,
    }));
    expect(html).toContain('Eastern');
    expect(html).not.toContain('zone-locked-needs-pickup-zone');
    expect(html).not.toContain(`>${getTranslations('en').rentalReturn.tzChange}</button>`);
  });
  it('the pickup event, which owns the zone, still gets its Change button when no zone is determined', () => {
    const html = renderToStaticMarkup(h(RentalEventScheduleField, {
      kind: 'pickup', label: 'Pickup', dateTime: '', onDateTime() {}, location: emptyRentalLocation(), onLocation() {},
      locationLabel: 'Pickup location', zone: noZone, onPickZone() {}, choice: null, onChoice() {}, deviceZone: null,
    }));
    expect(html).toContain(`>${getTranslations('en').rentalReturn.tzChange}</button>`);
  });
});

describe('the future-reservation form (rendered)', () => {
  it('EN: four labelled date/time inputs, "Same as pickup location" CHECKED by default, no vehicle or fuel fields', () => {
    const html = renderToStaticMarkup(h(QuickSaveRentalForm, { onCreated() {}, onCancel() {} }));
    for (const label of ['Pickup Date', 'Pickup Time', 'Return Date', 'Return Time']) expect(html).toContain(`>${label}</label>`);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
    expect(html).toContain('Same as pickup location');
    expect(html).toContain('Will use your pickup location once you add it');
    expect(html.match(/<label for=/g)!.length).toBeGreaterThanOrEqual(4);
    // The intro may EXPLAIN that the car and fuel are added at pickup; there must be no vehicle/fuel INPUT.
    expect(html).not.toContain('type="number"');
    expect(html).not.toMatch(/placeholder="[^"]*(VIN|gallon|tank|vehicle)/i);
    expect(html).not.toMatch(/data-rental-vehicle|vehicle-lookup/i);
  });
  it('ES: the same screen in Spanish', () => {
    state.locale = 'es';
    const html = renderToStaticMarkup(h(QuickSaveRentalForm, { onCreated() {}, onCancel() {} }));
    for (const label of ['Fecha de recogida', 'Hora de recogida', 'Fecha de devolución', 'Hora de devolución']) expect(html).toContain(`>${label}</label>`);
    expect(html).toContain('Igual que el lugar de recogida');
    expect(html).toContain('Elige una fecha');
  });
  it('the return time defaults from the pickup time and the pickup reports partial halves', () => {
    const src = read('components/rental-return/QuickSaveRentalForm.tsx');
    expect(src).toContain('defaultTime={pickupParts.time || undefined}');
    expect(src).toContain('onDateTimeParts={setPickupParts}');
    expect(src).toContain('useState(true)');                       // sameAsPickup defaults to checked
    expect(src).toMatch(/const \[sameAsPickup, setSameAsPickup\] = useState\(true\)/);
    expect(src).toContain('resolveReturnEvent({');
    expect(src).toContain('afterSameAsToggle()');
  });
  it('duplicate protection, reminders and the payload builder are unchanged', () => {
    const src = read('components/rental-return/QuickSaveRentalForm.tsx');
    expect(src).toContain('postCreateRental(');
    expect(src).toContain('mayConfirmDuplicate(');
    expect(src).toContain('buildQuickSavePayload({');
    expect(src).toContain('resyncRentalFallbacks(');
  });
});

describe('4. Edit Rental — close (X) button', () => {
  const session = {
    id: 'r1', userId: 'u', status: 'active', rentalCompany: 'Hertz', rentalAgreementNumber: null, rentalConfirmationNumber: null,
    vehicleYear: null, vehicleMake: null, vehicleModel: null, vehicleTrim: null, fuelTankCapacityGallons: null, pickupFuelGallons: null,
    requiredReturnFuelGallons: null, requiredReturnPolicyType: null, rentalFuelChargePerGallon: null,
    pickupDateTime: '2026-10-20T10:00', returnDateTime: '2026-10-24T10:00', pickupDateTimeUtc: '2026-10-20T14:00:00.000Z', returnDateTimeUtc: '2026-10-24T14:00:00.000Z',
    pickupTimeZone: 'America/New_York', returnTimeZone: 'America/New_York', pickupTimeZoneSource: 'user', returnTimeZoneSource: 'user', timeZone: null,
    pickupLocation: null, returnLocation: null, pickupLatitude: null, pickupLongitude: null, returnLatitude: null, returnLongitude: null,
    notes: null, currentFuelGallons: null, pickupFuelSource: null, currentFuelSource: null, refuelLogs: [],
  } as unknown as RentalSession;
  const render = () => renderToStaticMarkup(h(EditRentalModal, { session, onClose() {}, onSaved() {} }));

  it('EN: a button labelled "Close" in the title row, top-right, aligned with the Edit Rental title', () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*aria-label="Close"[^>]*data-testid="edit-rental-close"|<button[^>]*data-testid="edit-rental-close"[^>]*aria-label="Close"/);
    const row = /<div class="flex items-center justify-between gap-2"><p id="edit-rental-title"[^>]*>Edit Rental<\/p><button/.exec(html);
    expect(row).toBeTruthy();
  });
  it('ES: the accessible label is "Cerrar"', () => {
    state.locale = 'es';
    expect(render()).toContain('aria-label="Cerrar"');
  });
  it('a real, non-submitting button with a 44px tap target and a hidden decorative icon', () => {
    const html = render();
    const btn = /<button[^>]*data-testid="edit-rental-close"[^>]*>.*?<\/button>/.exec(html)![0];
    expect(btn).toContain('type="button"');
    expect(btn).toContain('h-11 w-11');
    expect(btn).toContain('aria-hidden="true"');
  });
  it('the dialog is labelled by the title; the bottom Cancel is still there', () => {
    const html = render();
    expect(html).toContain('aria-labelledby="edit-rental-title"');
    expect(html).toContain(`>${getTranslations('en').rentalReturn.cancel}</button>`);
  });
  it('closing is dismiss-only: the X calls onClose — never the save handler, never a request', () => {
    const src = read('components/rental-return/EditRentalModal.tsx');
    const start = src.indexOf('data-testid="edit-rental-close"');
    const block = src.slice(src.lastIndexOf('<button', start), src.indexOf('</button>', start));
    expect(block).toContain('onClick={onClose}');
    expect(block).not.toMatch(/handleSave|fetch\(|onSaved|setSaving/);
    // Cancel, Escape and outside-tap dismissal are unchanged
    expect(src).toMatch(/<button onClick=\{onClose\}[^>]*>\{t\.rentalReturn\.cancel\}<\/button>/);
    const shell = read('components/rental-return/ModalShell.tsx');
    expect(shell).toContain("e.key === 'Escape'");
    expect(shell).toContain('onClick={onClose}');
    expect(shell).toContain('onClick={(e) => e.stopPropagation()}');
  });
  it('ModalShell itself was not modified (scroll lock, focus and layout behaviour intact)', () => {
    const shell = read('components/rental-return/ModalShell.tsx');
    expect(shell).toContain("document.body.style.overflow = 'hidden'");
    expect(shell).toContain('min-h-full flex items-end sm:items-center justify-center p-4');
  });
});

describe('English and Spanish strings', () => {
  const en = getTranslations('en').rentalReturn, es = getTranslations('es').rentalReturn;
  const keys = ['pickupDateFieldLabel', 'pickupTimeFieldLabel', 'returnDateFieldLabel', 'returnTimeFieldLabel', 'dateEmptyHint', 'timeEmptyHint', 'returnTimeDefaultNote', 'tzLockedNeedsPickupZone', 'returnLocationSameAsPickup', 'returnLocationSameAsPickupEmpty', 'close'] as const;
  it('every new string exists in both languages, and Spanish differs from English', () => {
    for (const k of keys) { expect(en[k], `en.${k}`).toBeTruthy(); expect(es[k], `es.${k}`).toBeTruthy(); expect(es[k], k).not.toBe(en[k]); }
    expect(en.returnLocationSameAsPickupSummary('X')).toContain('X');
    expect(es.returnLocationSameAsPickupSummary('X')).toContain('X');
    expect(es.returnLocationSameAsPickupSummary('X')).not.toBe(en.returnLocationSameAsPickupSummary('X'));
  });
  it('the owner-specified labels are exact', () => {
    expect([en.pickupDateFieldLabel, en.pickupTimeFieldLabel, en.returnDateFieldLabel, en.returnTimeFieldLabel]).toEqual(['Pickup Date', 'Pickup Time', 'Return Date', 'Return Time']);
    expect(en.returnLocationSameAsPickup).toBe('Same as pickup location');
    expect(en.close).toBe('Close');
  });
});

describe('scope', () => {
  it('no API route, schema, notification, native or protected-path file is touched by these refinements', () => {
    const route = read('app/api/rental-sessions/route.ts');
    expect(route).not.toMatch(/sameAsPickup|defaultTime|dateTimeText/);
    expect(read('prisma/schema.prisma')).not.toMatch(/sameAsPickup/);
    expect(read('lib/helpRentalFaq.ts')).toContain('+ Add Rental → I have a future reservation');     // approved FAQs intact
  });
});
