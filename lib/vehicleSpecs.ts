/**
 * Rich vehicle specification data decoded from a VIN and EPA lookup.
 * Stored with the saved vehicle in the garage.
 */
export interface VehicleSpecs {
  // ── Identity ─────────────────────────────────────────────────────
  vin?:              string;
  manufacturer?:     string;   // e.g. "Honda of America"
  vehicleType?:      string;   // e.g. "PASSENGER CAR"
  bodyClass?:        string;   // e.g. "Sedan/Saloon"
  series?:           string;   // e.g. "LX, EX, Sport"

  // ── Drivetrain ───────────────────────────────────────────────────
  driveType?:        string;   // e.g. "AWD/All-Wheel Drive"
  transmission?:     string;   // e.g. "Automatic"

  // ── Engine ───────────────────────────────────────────────────────
  engineDisplL?:     number;   // litres
  engineCylinders?:  number;
  engineHP?:         number;   // brake horsepower
  engineTorqueLbFt?: number;   // lb-ft
  engineConfig?:     string;   // e.g. "V" "Inline"
  turbo?:            boolean;
  supercharger?:     boolean;
  fuelInjector?:     string;

  // ── Fuel / Economy (from EPA) ────────────────────────────────────
  fuelType?:         string;
  combMpg?:          number;
  cityMpg?:          number;
  hwyMpg?:           number;
  tankEstGallons?:   number;   // estimated from EPA range ÷ comb MPG
  rangeEstMiles?:    number;   // full-tank range estimate
  co2GPerMile?:      number;
  epaId?:            string;   // EPA vehicle ID for future lookups

  // ── Dimensions / Capacity ────────────────────────────────────────
  seats?:            number;
  wheelbaseIn?:      number;   // inches
  gvwr?:             string;   // e.g. "Class 1: 6,000 lb or less"

  // ── Safety ───────────────────────────────────────────────────────
  abs?:              boolean;
  tpmsType?:         string;   // "Direct" | "Indirect" | null
  backupCamera?:     boolean;
  blindSpotMonitor?: boolean;
  laneDeparture?:    boolean;
  adaptiveCruise?:   boolean;
  frontAirbags?:     string;   // e.g. "1st Row (Driver & Passenger)"
  sideAirbags?:      string;
  curtainAirbags?:   string;
  kneeAirbags?:      string;

  // ── Electric / plug-in hybrid ────────────────────────────────────
  // Set when the vehicle is saved from the EV calculator so the EV tab can
  // prefill battery + efficiency the same way Target Fill prefills tank size.
  // Lives here rather than as new Vehicle columns — no migration needed, and
  // these only apply to a minority of vehicles.
  batteryKwh?:       number;   // usable battery capacity
  efficiencyMiKwh?:  number;   // mi/kWh (EPA rating approx)
  isPHEV?:           boolean;  // burns gas too — appears in BOTH calculators

  // ── Metadata ─────────────────────────────────────────────────────
  decodedAt?:        string;   // ISO timestamp
}

/** True for battery-electric and plug-in hybrids — anything the EV tab handles. */
export function isElectric(fuelType?: string | null, specs?: VehicleSpecs | null): boolean {
  if (specs?.batteryKwh) return true;
  const f = (fuelType ?? '').toLowerCase();
  return f.includes('electric') || f.includes('phev') || f.includes('plug-in');
}

/** True for anything the gas calculator handles — includes PHEVs, which burn both. */
export function usesGasoline(fuelType?: string | null, specs?: VehicleSpecs | null): boolean {
  if (specs?.isPHEV) return true;
  const f = (fuelType ?? '').toLowerCase();
  if (f.includes('phev') || f.includes('plug-in')) return true;
  // Battery-electric only — no gasoline. Everything else (incl. blank) burns gas.
  return !(f.includes('electric') && !specs?.isPHEV);
}
