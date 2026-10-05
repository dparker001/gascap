/**
 * Return-location handling for the quick-save form ("Same as pickup location").
 *
 * While the box is checked the return location is DERIVED from the pickup
 * location on every render — never copied into state — so a pickup change can
 * never leave a stale copy behind, and the return event carries the pickup's
 * full location object (text, coordinates, place time zone) and its effective
 * zone with the same provenance ('place' / 'user' / 'device'): the same
 * physical place is in the same time zone. Unchecked, the return location and
 * its zone are fully independent (one-way rentals across time zones).
 */
import { emptyRentalLocation, type RentalLocationValue } from '@/components/rental-return/RentalLocationInput';
import { effectiveEventZone, type EventZone } from '@/components/rental-return/RentalEventScheduleField';
import type { TimeDisambiguation } from './rentalTimezone';

export interface ReturnEventInput {
  sameAsPickup:     boolean;
  pickupLoc:        RentalLocationValue;
  pickupZone:       EventZone;              // the pickup's EFFECTIVE zone
  returnLoc:        RentalLocationValue;    // the independently entered one (used only when unchecked)
  pickedReturnZone: EventZone | null;
  deviceZone:       string | null;
}

export function resolveReturnEvent(i: ReturnEventInput): { location: RentalLocationValue; zone: EventZone } {
  if (i.sameAsPickup) return { location: { ...i.pickupLoc }, zone: { ...i.pickupZone } };
  return { location: i.returnLoc, zone: effectiveEventZone(i.returnLoc, i.pickedReturnZone, i.deviceZone) };
}

/**
 * Toggling in EITHER direction starts the return side clean: unchecking gives
 * an empty independent location (never the old pickup copy, whose coordinates
 * would be stale for whatever is typed next); rechecking discards anything
 * entered manually so the current pickup location is used.
 */
export function afterSameAsToggle(): {
  returnLoc: RentalLocationValue; pickedReturnZone: EventZone | null; returnChoice: TimeDisambiguation | null;
} {
  return { returnLoc: emptyRentalLocation(), pickedReturnZone: null, returnChoice: null };
}
