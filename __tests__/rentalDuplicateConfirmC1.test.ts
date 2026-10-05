/** PR #62 finding 4 — the duplicate "Save anyway" confirmation is bound to the warned reservation. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { duplicateConfirmationKey, activeDuplicateWarning, mayConfirmDuplicate, type DuplicateKeyFields } from '@/lib/rentalDuplicateConfirm';

const base: DuplicateKeyFields = {
  company: 'Hertz', confirmationNumber: 'AB-123', agreementNumber: '',
  pickupDateTime: '2026-10-10T10:00', returnDateTime: '2026-10-13T10:00',
  pickupLocation: 'MCO Airport', returnLocation: 'MCO Airport',
  pickupLat: 28.4312, pickupLng: -81.3081, returnLat: 28.4312, returnLng: -81.3081,
  pickupZone: 'America/New_York', returnZone: 'America/New_York', pickupChoice: null, returnChoice: null,
};
const key = (over: Partial<DuplicateKeyFields> = {}) => duplicateConfirmationKey({ ...base, ...over });

describe('duplicateConfirmationKey', () => {
  it('is stable for the same reservation, and ignores case/spacing noise in company, confirmation and locations', () => {
    expect(key()).toBe(key());
    expect(key({ company: '  hertz ', confirmationNumber: 'ab 123', pickupLocation: ' mco airport ' })).toBe(key());
  });
  it('changes when ANY reservation-identifying field changes', () => {
    const changes: Array<Partial<DuplicateKeyFields>> = [
      { company: 'Avis' }, { confirmationNumber: 'ZZ-999' }, { agreementNumber: 'RA-1' },
      { pickupDateTime: '2026-10-10T11:00' }, { returnDateTime: '2026-10-14T10:00' },
      { pickupLocation: 'LAX' }, { returnLocation: 'LAX' },
      { pickupLat: 28.5 }, { pickupLng: -81.4 }, { returnLat: 33.94 }, { returnLng: -118.4 },
      { pickupZone: 'America/Los_Angeles' }, { returnZone: 'Europe/London' },
      { pickupChoice: 'later' }, { returnChoice: 'earlier' },
    ];
    for (const c of changes) expect(key(c), JSON.stringify(c)).not.toBe(key());
  });
  it('COORDINATES bind the reservation: same place name at different coordinates, or coordinates added/removed, is a change', () => {
    expect(key({ pickupLat: null, pickupLng: null })).not.toBe(key());
    expect(key({ pickupLat: 28.43121, pickupLng: -81.30811 })).not.toBe(key());   // ~1 m away
    expect(key({ returnLat: null })).not.toBe(key());
  });
  it('but float noise below ~1 m is not a change', () => {
    expect(key({ pickupLat: 28.4312000001, pickupLng: -81.3081000002 })).toBe(key());
  });
  it('a confirmation number cleared to blank is a change', () => {
    expect(key({ confirmationNumber: '' })).not.toBe(key());
  });
});

describe('binding the confirmation to the warned reservation', () => {
  const warning = { rentalId: 'r1', key: key() };
  it('the warning applies to the exact reservation and nothing else', () => {
    expect(activeDuplicateWarning(warning, key())).toBe(warning);
    expect(activeDuplicateWarning(warning, key({ confirmationNumber: 'ZZ-999' }))).toBeNull();
    expect(activeDuplicateWarning(null, key())).toBeNull();
  });
  it('Save anyway may carry confirmDuplicate only while the form still matches', () => {
    expect(mayConfirmDuplicate(warning, key())).toBe(true);
    expect(mayConfirmDuplicate(warning, key({ pickupDateTime: '2026-10-20T10:00' }))).toBe(false);
    expect(mayConfirmDuplicate(null, key())).toBe(false);
  });
  it('editing a field and then reverting it re-validates the SAME warning (it was about that reservation)', () => {
    expect(mayConfirmDuplicate(warning, key({ company: 'Avis' }))).toBe(false);
    expect(mayConfirmDuplicate(warning, key({ company: 'Hertz' }))).toBe(true);
  });
  it('the coordinates scenario: warned for one MCO location, the place is swapped for a same-named one elsewhere — no confirmation', () => {
    expect(mayConfirmDuplicate(warning, key({ pickupLat: 28.6, pickupLng: -81.2 }))).toBe(false);
  });
  it('the scenario that bypassed it: warned for A, edited into B (a different duplicate), Save anyway must NOT confirm B', () => {
    const edited = key({ company: 'Avis', confirmationNumber: 'QQ-1' });
    expect(mayConfirmDuplicate(warning, edited)).toBe(false);
  });
});

describe('both create forms use the binding (source guards)', () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');
  for (const f of ['components/rental-return/QuickSaveRentalForm.tsx', 'components/rental-return/RentalSetupFlow.tsx']) {
    it(`${path.basename(f)}: confirm is gated on the key, the warning stores the SUBMITTED key, the notice shows only for the active warning`, () => {
      const src = read(f);
      expect(src).toContain('duplicateConfirmationKey({');
      expect(src).toContain('pickupLat: pickupLoc.lat ?? null, pickupLng: pickupLoc.lng ?? null, returnLat: returnLoc.lat ?? null, returnLng: returnLoc.lng ?? null');
      expect(src).toContain('const confirm = confirmDuplicate && mayConfirmDuplicate(duplicateWarning, reservationKey);');
      expect(src).toContain('const submittedKey = reservationKey;');
      expect(src).toContain('setDuplicateWarning({ rentalId: out.rentalId, key: submittedKey })');
      expect(src).toContain('{activeDuplicate && (');
      expect(src).not.toMatch(/setDuplicateId|duplicateId/);                  // the unbound id state is gone
      expect(src).toMatch(/clientRentalId, confirm\b/);                       // the gated value is what is sent
      expect(src).not.toMatch(/clientRentalId, confirmDuplicate\b/);          // …never the raw argument
    });
  }
});
