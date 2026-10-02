/**
 * Quick-save an upcoming rental — Part A (2026-10-02). A second entry point
 * beside the full setup wizard for a rental booked ahead: only what a booking
 * knows. Vehicle, tank, pickup fuel, fuel rate and photos are deliberately
 * absent (never defaulted) and are added at the counter via Finish setup.
 *
 * The payload goes to the SAME create endpoint as the wizard, so the server's
 * Pro gate, IANA-zone validation, DST rules and UTC derivation all apply
 * unchanged. Pickup date/time is required here: it is what makes the rental
 * "upcoming" and drives the pickup reminders.
 */
import type { RentalLocationValue } from '@/components/rental-return/RentalLocationInput';
import type { EventZone } from '@/components/rental-return/RentalEventScheduleField';
import type { EventTimeStatus, TimeDisambiguation } from '@/lib/rentalTimezone';

export interface QuickSaveEvent {
  dateTime: string;
  location: RentalLocationValue;
  zone:     EventZone;
  status:   EventTimeStatus;
  choice:   TimeDisambiguation | null;
}

export interface QuickSaveInput {
  company:            string;
  confirmationNumber: string;
  pickup:             QuickSaveEvent;
  ret:                QuickSaveEvent;
  deviceZone:         string | null;
}

// Stricter than the wizard: each time must resolve in a zone (valid or an
// explicitly-chosen ambiguous occurrence). A zoneless time would save with no
// UTC instant — and so silently no pickup reminders, the point of this path.
const timeOk = (s: EventTimeStatus) => s.kind === 'valid' || s.kind === 'ambiguous';

export function quickSaveCanSubmit(i: Pick<QuickSaveInput, 'company' | 'pickup' | 'ret'>): boolean {
  return !!i.company.trim()
    && !!i.pickup.dateTime && timeOk(i.pickup.status)
    && !!i.ret.dateTime && timeOk(i.ret.status);
}

const occurrence = (e: QuickSaveEvent): TimeDisambiguation | undefined =>
  e.status.kind === 'ambiguous' ? (e.choice ?? 'earlier') : undefined;

/** POST /api/rental-sessions body. No vehicle / tank / fuel / rate fields — ever. */
export function buildQuickSavePayload(i: QuickSaveInput): Record<string, unknown> {
  return {
    rentalCompany:            i.company.trim(),
    rentalConfirmationNumber: i.confirmationNumber.trim() || undefined,
    requiredReturnPolicyType: 'same_as_pickup',
    pickupLocation:   i.pickup.location.text || undefined,
    pickupLatitude:   i.pickup.location.lat ?? undefined,
    pickupLongitude:  i.pickup.location.lng ?? undefined,
    returnLocation:   i.ret.location.text || undefined,
    returnLatitude:   i.ret.location.lat ?? undefined,
    returnLongitude:  i.ret.location.lng ?? undefined,
    pickupDateTime:   i.pickup.dateTime,
    returnDateTime:   i.ret.dateTime,
    pickupTimeZone:        i.pickup.zone.zone ?? undefined,
    pickupTimeZoneSource:  i.pickup.zone.source ?? undefined,
    returnTimeZone:        i.ret.zone.zone ?? undefined,
    returnTimeZoneSource:  i.ret.zone.source ?? undefined,
    pickupTimeDisambiguation: occurrence(i.pickup),
    returnTimeDisambiguation: occurrence(i.ret),
    // Legacy device zone, backward compatibility only (same as the wizard).
    timeZone: i.deviceZone ?? undefined,
  };
}
