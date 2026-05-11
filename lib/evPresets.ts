// ─────────────────────────────────────────────
//  GasCap™ — EV & PHEV Battery Presets
// ─────────────────────────────────────────────

export interface EvPreset {
  label:              string;
  batteryKwh:         number;   // usable battery capacity
  defaultEfficiency?: number;   // mi/kWh (EPA rating approx)
  isPHEV:             boolean;
}

export const EV_PRESETS: EvPreset[] = [
  // ── Tesla ──
  { label: 'Tesla Model 3 Standard Range',   batteryKwh: 57.5, defaultEfficiency: 3.9, isPHEV: false },
  { label: 'Tesla Model 3 Long Range',       batteryKwh: 82.0, defaultEfficiency: 4.2, isPHEV: false },
  { label: 'Tesla Model Y Standard Range',   batteryKwh: 60.0, defaultEfficiency: 3.5, isPHEV: false },
  { label: 'Tesla Model Y Long Range',       batteryKwh: 75.0, defaultEfficiency: 3.8, isPHEV: false },
  { label: 'Tesla Model S',                  batteryKwh: 100.0, defaultEfficiency: 3.1, isPHEV: false },
  { label: 'Tesla Model X',                  batteryKwh: 100.0, defaultEfficiency: 2.8, isPHEV: false },
  { label: 'Tesla Cybertruck (AWD)',          batteryKwh: 123.0, defaultEfficiency: 2.5, isPHEV: false },
  // ── Chevrolet ──
  { label: 'Chevy Bolt EV',                  batteryKwh: 65.0, defaultEfficiency: 3.5, isPHEV: false },
  { label: 'Chevy Equinox EV',               batteryKwh: 85.0, defaultEfficiency: 3.5, isPHEV: false },
  // ── Nissan ──
  { label: 'Nissan Leaf (40 kWh)',            batteryKwh: 40.0, defaultEfficiency: 3.2, isPHEV: false },
  { label: 'Nissan Leaf Plus (62 kWh)',       batteryKwh: 62.0, defaultEfficiency: 3.0, isPHEV: false },
  { label: 'Nissan Ariya',                    batteryKwh: 87.0, defaultEfficiency: 3.2, isPHEV: false },
  // ── Ford ──
  { label: 'Ford Mustang Mach-E (SR)',        batteryKwh: 68.0, defaultEfficiency: 3.1, isPHEV: false },
  { label: 'Ford Mustang Mach-E (ER)',        batteryKwh: 91.0, defaultEfficiency: 3.0, isPHEV: false },
  { label: 'Ford F-150 Lightning',            batteryKwh: 131.0, defaultEfficiency: 2.0, isPHEV: false },
  // ── Hyundai / Kia / Genesis ──
  { label: 'Hyundai Ioniq 5',                batteryKwh: 77.4, defaultEfficiency: 3.5, isPHEV: false },
  { label: 'Hyundai Ioniq 6',                batteryKwh: 77.4, defaultEfficiency: 4.0, isPHEV: false },
  { label: 'Kia EV6',                        batteryKwh: 77.4, defaultEfficiency: 3.7, isPHEV: false },
  { label: 'Kia EV9',                        batteryKwh: 99.8, defaultEfficiency: 2.9, isPHEV: false },
  { label: 'Genesis GV60',                   batteryKwh: 77.4, defaultEfficiency: 3.5, isPHEV: false },
  // ── Volkswagen ──
  { label: 'VW ID.4 (Standard)',              batteryKwh: 62.0, defaultEfficiency: 3.2, isPHEV: false },
  { label: 'VW ID.4 (Long Range)',            batteryKwh: 82.0, defaultEfficiency: 3.0, isPHEV: false },
  // ── BMW ──
  { label: 'BMW i4 eDrive40',                batteryKwh: 83.9, defaultEfficiency: 3.5, isPHEV: false },
  { label: 'BMW iX xDrive50',                batteryKwh: 111.0, defaultEfficiency: 2.9, isPHEV: false },
  // ── Rivian ──
  { label: 'Rivian R1T (Standard)',           batteryKwh: 135.0, defaultEfficiency: 2.2, isPHEV: false },
  { label: 'Rivian R1T (Large)',              batteryKwh: 180.0, defaultEfficiency: 2.5, isPHEV: false },
  { label: 'Rivian R1S',                     batteryKwh: 135.0, defaultEfficiency: 2.2, isPHEV: false },
  // ── Mercedes / Audi / Porsche ──
  { label: 'Mercedes EQS 450+',             batteryKwh: 107.8, defaultEfficiency: 3.2, isPHEV: false },
  { label: 'Audi e-tron GT',                batteryKwh: 93.4, defaultEfficiency: 2.9, isPHEV: false },
  { label: 'Porsche Taycan',                batteryKwh: 93.4, defaultEfficiency: 2.7, isPHEV: false },
  // ── Lucid ──
  { label: 'Lucid Air Grand Touring',        batteryKwh: 112.0, defaultEfficiency: 4.6, isPHEV: false },
];

export const PHEV_PRESETS: EvPreset[] = [
  { label: 'Toyota Prius Prime',             batteryKwh: 8.8,  defaultEfficiency: 2.5, isPHEV: true },
  { label: 'Toyota RAV4 Prime',              batteryKwh: 18.1, defaultEfficiency: 2.8, isPHEV: true },
  { label: 'Chevy Volt',                     batteryKwh: 18.4, defaultEfficiency: 3.5, isPHEV: true },
  { label: 'Ford Escape PHEV',               batteryKwh: 14.4, defaultEfficiency: 2.8, isPHEV: true },
  { label: 'Ford F-150 PHEV',               batteryKwh: 18.0, defaultEfficiency: 2.5, isPHEV: true },
  { label: 'Jeep Wrangler 4xe',              batteryKwh: 17.0, defaultEfficiency: 2.1, isPHEV: true },
  { label: 'Jeep Grand Cherokee 4xe',        batteryKwh: 17.0, defaultEfficiency: 2.3, isPHEV: true },
  { label: 'Chrysler Pacifica Hybrid',       batteryKwh: 16.0, defaultEfficiency: 2.8, isPHEV: true },
  { label: 'BMW 330e',                       batteryKwh: 12.0, defaultEfficiency: 3.2, isPHEV: true },
  { label: 'Hyundai Tucson PHEV',            batteryKwh: 13.8, defaultEfficiency: 2.6, isPHEV: true },
  { label: 'Kia Sportage PHEV',              batteryKwh: 13.8, defaultEfficiency: 2.6, isPHEV: true },
  { label: 'Volvo XC60 Recharge',            batteryKwh: 14.9, defaultEfficiency: 2.5, isPHEV: true },
];
