/**
 * Part A (2026-10-02) — what a rental still needs before GasCap can do fuel
 * math, and the small decisions the dashboard makes from that. Pure, so the
 * "never invent a reading" rules are unit-tested rather than only rendered.
 *
 * Setup order is enforced: vehicle → tank capacity → pickup fuel. A gauge or
 * percent reading means nothing without a tank, so pickup fuel is locked
 * until a capacity exists (the server refuses it too — see
 * RentalScheduleError 'tank_capacity_required').
 */
import type { FuelInputMethod } from '@/components/rental-return/FuelLevelInput';

export interface SetupStateInput {
  status:                     string;
  vehicleMake:                string | null;
  vehicleModel:               string | null;
  fuelTankCapacityGallons:    number | null;
  pickupFuelGallons:          number | null;
  currentFuelGallons:         number | null;
  currentFuelSource?:         string | null;
  pickupFuelSource?:          string | null;
  requiredReturnFuelGallons:  number | null;
}

export type SetupStepKey = 'vehicle' | 'tank' | 'pickupFuel';
export interface SetupStep { key: SetupStepKey; done: boolean; locked: boolean }

export const hasTank = (s: Pick<SetupStateInput, 'fuelTankCapacityGallons'>): boolean =>
  typeof s.fuelTankCapacityGallons === 'number' && s.fuelTankCapacityGallons > 0;

/** The three setup steps, in order. A step is locked until the one before it is done. */
export function rentalSetupSteps(s: SetupStateInput): SetupStep[] {
  const vehicle = !!(s.vehicleMake?.trim() && s.vehicleModel?.trim());
  const tank = hasTank(s);
  const pickup = s.pickupFuelGallons != null;
  return [
    { key: 'vehicle',    done: vehicle, locked: false },
    // A tank size can be entered without a looked-up vehicle (Edit modal), so
    // it is never locked behind the vehicle step — only ordered after it.
    { key: 'tank',       done: tank,    locked: false },
    { key: 'pickupFuel', done: pickup,  locked: !tank && !pickup },
  ];
}

/** Show the Finish setup card: an open rental with any step not done. */
export function setupIncomplete(s: SetupStateInput): boolean {
  if (s.status !== 'active') return false;
  return rentalSetupSteps(s).some((step) => !step.done);
}

/** Fuel input methods available: gauge/percent need a tank; exact gallons never does. */
export function fuelInputMethodsFor(tankCapacity: number | null | undefined): FuelInputMethod[] {
  return typeof tankCapacity === 'number' && tankCapacity > 0 ? ['gauge', 'percent', 'gallons'] : ['gallons'];
}

/**
 * Saving a pickup reading also seeds the CURRENT reading only while nothing
 * has happened since pickup: no refuel logged, and the current reading is
 * unset or still exactly the old pickup reading. After a refuel the pickup
 * level says nothing about what's in the tank now.
 */
export function pickupSaveAlsoSetsCurrent(s: SetupStateInput, rentalFillupCount: number): boolean {
  if (rentalFillupCount > 0) return false;
  if (s.currentFuelGallons == null) return true;
  return s.currentFuelGallons === s.pickupFuelGallons && (s.currentFuelSource ?? null) === (s.pickupFuelSource ?? null);
}

/** The return target is a real number (never treat an unknown target as 0). */
export const returnTargetKnown = (s: Pick<SetupStateInput, 'requiredReturnFuelGallons'>): boolean =>
  s.requiredReturnFuelGallons != null;
