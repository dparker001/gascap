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

  // ── Metadata ─────────────────────────────────────────────────────
  decodedAt?:        string;   // ISO timestamp
}
