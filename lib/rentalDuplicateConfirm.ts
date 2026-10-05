/**
 * PR #62 finding 4 — a "Save anyway" confirmation is a decision about ONE
 * reservation, not a standing permission. The duplicate warning is bound to a
 * key built from every field that identifies the reservation; the moment any
 * of them changes the warning is void, the confirmation can't be used, and
 * the next save re-runs the server's duplicate check.
 */
export interface DuplicateKeyFields {
  company: string;
  confirmationNumber: string;
  agreementNumber?: string;
  pickupDateTime: string;
  returnDateTime: string;
  pickupLocation: string;
  returnLocation: string;
  /** Place coordinates travel with the reservation (a different place with the same name is a different reservation). */
  pickupLat: number | null;
  pickupLng: number | null;
  returnLat: number | null;
  returnLng: number | null;
  pickupZone: string | null;
  returnZone: string | null;
  pickupChoice: string | null;
  returnChoice: string | null;
}

const norm = (v: string | null | undefined) => (v ?? '').trim();
/** ~1 m precision: stable against float noise, sensitive to a genuinely different place. */
const coord = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(5) : '');

/** Stable key over the reservation-identifying fields (whitespace-insensitive, case-sensitive times/zones). */
export function duplicateConfirmationKey(f: DuplicateKeyFields): string {
  return JSON.stringify([
    norm(f.company).toLowerCase(),
    norm(f.confirmationNumber).toUpperCase().replace(/[^A-Z0-9]/g, ''),
    norm(f.agreementNumber).toUpperCase().replace(/[^A-Z0-9]/g, ''),
    norm(f.pickupDateTime), norm(f.returnDateTime),
    norm(f.pickupLocation).toLowerCase(), norm(f.returnLocation).toLowerCase(),
    coord(f.pickupLat), coord(f.pickupLng), coord(f.returnLat), coord(f.returnLng),
    f.pickupZone ?? '', f.returnZone ?? '', f.pickupChoice ?? '', f.returnChoice ?? '',
  ]);
}

export interface DuplicateWarning { rentalId: string; key: string }

/** The warning that applies to the CURRENT form, or null once anything changed. */
export function activeDuplicateWarning(warning: DuplicateWarning | null, currentKey: string): DuplicateWarning | null {
  return warning && warning.key === currentKey ? warning : null;
}

/** May this submit carry confirmDuplicate? Only for the exact reservation that was warned about. */
export function mayConfirmDuplicate(warning: DuplicateWarning | null, currentKey: string): boolean {
  return activeDuplicateWarning(warning, currentKey) !== null;
}
