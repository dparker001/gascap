/**
 * Vehicle body-type detection + SVG silhouette paths
 *
 * Shared by GarageDoor (door panel etchings) and SavedVehicles (card backgrounds).
 * SVG paths use viewBox "0 0 100 40" — front of vehicle faces LEFT.
 * Wheel wells are cubic-bezier arches cut from the bottom of each profile.
 */

export type VehicleType = 'coupe' | 'sedan' | 'suv' | 'truck' | 'van';

export interface VehicleInfo {
  name:   string;
  make?:  string;
  model?: string;
}

/**
 * Infer a body type from name / make / model keywords.
 * Order matters — coupe is checked before sedan to catch Challenger/Charger.
 */
export function detectVehicleType(v: VehicleInfo): VehicleType {
  const text = [v.name, v.make, v.model]
    .filter(Boolean).join(' ').toLowerCase();

  // Muscle cars / coupes — checked first so Challenger/Charger aren't sedan
  if (/\b(challenger|charger|mustang|camaro|corvette|viper|firebird|trans.?am|gt500|shelby|hellcat|scat.?pack|widebody|coupe|2.?door|fastback|pony|hemi|barracuda|cuda|javelin|gto|442|skylark|cutlass)\b/.test(text))
    return 'coupe';

  // Pickup trucks
  if (/\b(truck|pickup|f-?150|f-?250|f-?350|silverado|sierra|ram\b|tundra|tacoma|frontier|ridgeline|colorado|canyon|ranger|maverick|gladiator|titan)\b/.test(text))
    return 'truck';

  // Vans & minivans
  if (/\b(van|minivan|caravan|odyssey|sienna|pacifica|transit|express|savana|voyager|town.?country)\b/.test(text))
    return 'van';

  // SUVs & crossovers
  if (/\b(suv|crossover|explorer|expedition|tahoe|suburban|yukon|escalade|4runner|highlander|rav4|cr-?v|cx-?[0-9]|pilot|traverse|equinox|edge|escape|rogue|murano|pathfinder|armada|sequoia|land.?cruiser|wrangler|compass|cherokee|durango|terrain|blazer|bronco|defender|range.?rover|navigator|santa.?fe|tucson|sportage|telluride|palisade|atlas|tiguan|passport|4wd|awd|4x4)\b/.test(text))
    return 'suv';

  return 'sedan';
}

/**
 * SVG path data for each body type.
 * viewBox "0 0 100 40" — cubic-bezier arches form the wheel wells.
 */
export const VEHICLE_PATHS: Record<VehicleType, string> = {
  // Muscle car / coupe: long hood, low fastback roofline, wide wheel arches
  coupe:
    'M4,34 L4,27 L10,17 L22,10 L36,7 L64,7 L80,11 L92,22 L96,29 L96,34 ' +
    'L88,34 C88,24 74,24 74,34 ' +
    'L26,34 C26,24 12,24 12,34 Z',

  // Classic 3-box sedan: sloped hood, defined roofline, short trunk
  sedan:
    'M4,34 L4,24 L16,13 L28,10 L72,10 L84,13 L96,24 L96,34 ' +
    'L88,34 C88,26 72,26 72,34 ' +
    'L28,34 C28,26 12,26 12,34 Z',

  // SUV / crossover: tall, boxier, higher roofline
  suv:
    'M4,34 L4,20 L11,10 L22,7 L78,7 L89,10 L96,20 L96,34 ' +
    'L88,34 C88,26 72,26 72,34 ' +
    'L28,34 C28,26 12,26 12,34 Z',

  // Pickup truck: tall cab on left, low flat bed on right, 2 wheel arches
  truck:
    'M4,34 L4,22 L10,11 Q16,8 22,8 L56,8 L58,14 L96,14 L96,34 ' +
    'L88,34 C88,26 72,26 72,34 ' +
    'L28,34 C28,26 12,26 12,34 Z',

  // Van / minivan: very tall, near-vertical sides, curved rear
  van:
    'M4,34 L4,14 L9,8 L18,6 L76,6 L85,10 L93,18 L96,24 L96,34 ' +
    'L88,34 C88,26 72,26 72,34 ' +
    'L28,34 C28,26 12,26 12,34 Z',
};
