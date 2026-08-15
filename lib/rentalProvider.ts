/**
 * GasCap™ Rental Return Assistant — data-source abstraction (Level 1 / 2).
 *
 * The UI and calculation engine (lib/rentalCalculations.ts) consume ONLY
 * NormalizedRentalData / RentalSession — never a provider's raw shape.
 * Level 1 ships exactly one provider, ManualRentalDataProvider, backed by
 * renter-entered data. Level 2 adds real rental-company/telematics
 * providers behind this same interface; nothing above this layer should
 * need to change when that happens. See docs/RENTAL_INTEGRATION_LEVEL2.md.
 */

// ── Fuel data confidence ────────────────────────────────────────────────────
// The difference between "the renter estimated this from a gauge picture"
// and "the rental company's system reported this exact figure" matters a
// lot once real providers exist — surfaced in the UI as "Estimated" vs.
// "Rental-company reported" / "Vehicle-reported."
export const FUEL_DATA_SOURCES = [
  'MANUAL_GAUGE',        // renter picked a fraction (Full, 7/8, 3/4, ...)
  'MANUAL_PERCENT',      // renter typed a percentage
  'MANUAL_GALLONS',      // renter typed an exact gallon figure
  'RECEIPT',             // derived from a logged refuel (gallons purchased, known)
  'RENTAL_COMPANY_API',  // Level 2 — authoritative, from the rental company
  'VEHICLE_TELEMATICS',  // Level 2 — authoritative, from the vehicle itself
] as const;
export type FuelDataSource = typeof FUEL_DATA_SOURCES[number];

/** True for sources GasCap did not estimate — reported directly by an authoritative system. */
export function isAuthoritativeSource(source: FuelDataSource | null | undefined): boolean {
  return source === 'RENTAL_COMPANY_API' || source === 'VEHICLE_TELEMATICS';
}

// ── Normalized rental data (provider-independent) ──────────────────────────

export interface LocationData {
  label?:     string;
  lat?:       number;
  lng?:       number;
}

export interface NormalizedRentalData {
  provider:          string;           // 'manual' | future provider id, e.g. 'avis'
  externalRentalId?: string;
  rentalCompany:     string;
  vehicle?: {
    vin?:                 string;
    year?:                string;
    make?:                string;
    model?:               string;
    trim?:                string;
    tankCapacityGallons?: number;
  };
  pickup?: {
    timestamp?:   string;  // ISO
    location?:    LocationData;
    fuelGallons?: number;
    fuelSource?:  FuelDataSource;
  };
  returnRequirement?: {
    fuelGallons?: number;
    policyType?:  'same_as_pickup' | 'full' | 'exact';
  };
  currentVehicleState?: {
    timestamp?:   string;
    fuelGallons?: number;
    fuelSource?:  FuelDataSource;
    odometer?:    number;
  };
  returnDetails?: {
    timestamp?: string;
    location?:  LocationData;
  };
  pricing?: {
    rentalFuelPricePerGallon?: number;
  };
}

export interface RefuelLogEntry {
  id:              string;
  timestamp:       string; // ISO
  gallons:         number;
  pricePerGallon?: number;
  totalPaid?:      number;
  stationName?:    string;
  stationLat?:     number;
  stationLng?:     number;
  receiptPhotoThumb?: string; // base64 data URL, same pattern as Fillup.receiptThumb
  odometer?:       number;
}

// ── Manual input helpers (Level 1) ──────────────────────────────────────────

const GAUGE_FRACTIONS: Record<string, number> = {
  full: 1, '7/8': 0.875, '3/4': 0.75, '5/8': 0.625,
  '1/2': 0.5, '3/8': 0.375, '1/4': 0.25, '1/8': 0.125, empty: 0,
};

/**
 * Convert a gauge fraction label ('3/4', 'full', ...) to estimated gallons.
 * Returns the UNROUNDED value (e.g. 11.25, not 11.3) — display rounding
 * happens only in formatGallons() (lib/rentalCalculations.ts), so it never
 * compounds across a chain of calculations. Rounded to 6 decimals purely to
 * clear floating-point noise, not to impose display precision.
 */
export function gallonsFromGaugeFraction(fraction: string, tankCapacityGallons: number): number | null {
  const frac = GAUGE_FRACTIONS[fraction.toLowerCase().trim()];
  if (frac === undefined || !(tankCapacityGallons > 0)) return null;
  return Math.round(frac * tankCapacityGallons * 1_000_000) / 1_000_000;
}

/**
 * Convert a percentage (0–100) to estimated gallons. Returns null for
 * out-of-range input. Unrounded for the same reason as gallonsFromGaugeFraction.
 */
export function gallonsFromPercent(percent: number, tankCapacityGallons: number): number | null {
  if (!(percent >= 0) || percent > 100 || !(tankCapacityGallons > 0)) return null;
  return Math.round((percent / 100) * tankCapacityGallons * 1_000_000) / 1_000_000;
}

// ── Provider interface ──────────────────────────────────────────────────────

export interface RentalDataProvider {
  readonly id:   string;   // 'manual' | 'avis' | 'hertz' | 'enterprise' | 'connected_vehicle' | ...
  readonly name: string;
  /** Which optional capabilities this provider can actually supply — Level 2
   *  providers won't all support everything (a connected-car feed may have
   *  no concept of "rental agreement number," for instance). */
  readonly capabilities: {
    vehicleSpecs:        boolean;
    pickupFuelLevel:     boolean;
    returnRequirement:   boolean;
    currentFuelLevel:    boolean;
    returnLocation:      boolean;
    rentalFuelRate:      boolean;
    odometer:            boolean;
  };
  /** Normalize whatever this provider's input looks like into the common shape. */
  normalize(input: unknown): NormalizedRentalData;
}

/**
 * Level 1's only real provider — the renter is the data source. `input` is
 * already close to NormalizedRentalData shape (it's built directly from
 * form state), so normalize() here is mostly a pass-through with defaults
 * filled in, but it exists so callers never special-case "manual" vs a real
 * provider — they always go through this interface.
 */
export const ManualRentalDataProvider: RentalDataProvider = {
  id:   'manual',
  name: 'Manual entry',
  capabilities: {
    vehicleSpecs:      true,
    pickupFuelLevel:   true,
    returnRequirement: true,
    currentFuelLevel:  true,
    returnLocation:    true,
    rentalFuelRate:    true,
    odometer:          true,
  },
  normalize(input: unknown): NormalizedRentalData {
    const d = input as Partial<NormalizedRentalData>;
    return {
      provider:          'manual',
      rentalCompany:     d.rentalCompany ?? '',
      externalRentalId:  d.externalRentalId,
      vehicle:           d.vehicle,
      pickup:            d.pickup,
      returnRequirement: d.returnRequirement,
      currentVehicleState: d.currentVehicleState,
      returnDetails:     d.returnDetails,
      pricing:           d.pricing,
    };
  },
};

/**
 * Level 2 stubs — intentionally interface-only. Each future provider
 * implements RentalDataProvider and registers here; nothing else in the
 * app (routes, UI, calculation engine) needs to change to add one, since
 * they all normalize into the same NormalizedRentalData shape.
 *
 * Not implemented yet: requires OAuth/API credentials per rental company
 * (see docs/RENTAL_INTEGRATION_LEVEL2.md § Authentication) that GasCap
 * does not currently have.
 */
export const RENTAL_PROVIDER_REGISTRY: Record<string, RentalDataProvider> = {
  manual: ManualRentalDataProvider,
  // avis:              AvisRentalProvider,
  // hertz:             HertzRentalProvider,
  // enterprise:        EnterpriseRentalProvider,
  // sixt:              SixtRentalProvider,
  // connected_vehicle: ConnectedVehicleProvider,
};

export function getRentalProvider(id: string): RentalDataProvider {
  return RENTAL_PROVIDER_REGISTRY[id] ?? ManualRentalDataProvider;
}

// ── Rental company list (section 6, step 1) — not assumed static ───────────
export const RENTAL_COMPANIES = [
  'Avis', 'Budget', 'Hertz', 'Dollar', 'Thrifty',
  'Enterprise', 'National', 'Alamo', 'Sixt', 'Other',
] as const;
