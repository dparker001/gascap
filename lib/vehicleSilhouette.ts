/**
 * Vehicle body-type detection + SVG silhouette paths
 *
 * Used by SavedVehicles (vehicle card illustrations) and GarageDoor (settings preview).
 * SVG paths use viewBox "0 0 200 80" — front of vehicle faces LEFT.
 *
 * Each VEHICLE_PATHS entry contains TWO sub-paths separated by a space:
 *   1. Outer body outline  — clockwise (filled)
 *   2. Greenhouse/windows  — counter-clockwise (creates a transparent hole via evenodd)
 *
 * The consumer SVG must set fillRule="evenodd" (or fill-rule="evenodd") to
 * render the window cutouts correctly.
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
 * SVG path data for each body type. viewBox "0 0 200 80".
 *
 * Two sub-paths per type (body CW + windows CCW). Render with fillRule="evenodd"
 * to produce transparent window cutouts that reveal the card background through.
 *
 * Key proportions (front = left, x≈10; rear = right, x≈180-186):
 *   sedan  — long hood, 3-box roof + trunk, moderate ride height
 *   coupe  — very long hood, low fastback, short cockpit
 *   suv    — shorter hood, tall upright greenhouse, no separate trunk
 *   truck  — medium hood, short cab, flat open bed at mid height, tall stance
 *   van    — cab-forward (very short hood), very tall box, long body
 */
export const VEHICLE_PATHS: Record<VehicleType, string> = {

  // ── SEDAN (Buick Verano, Ford Fusion) ────────────────────────────────────
  // Classic 3-box: long hood, defined roofline, short trunk visible at rear
  sedan:
    // Body (clockwise)
    'M14,68 L10,64 L10,58 L14,50 L20,42 L24,36 L28,32 L88,26 L104,18 L114,12 L120,10 L148,10 L162,13 L170,20 L176,28 L180,36 L184,46 L184,60 L182,65 L178,68 ' +
    'L167,68 Q153,57 139,68 L54,68 Q40,57 26,68 Z ' +
    // Windows (counter-clockwise → evenodd hole)
    'M104,30 L161,30 L169,22 L161,14 L148,12 L120,12 Z',

  // ── COUPE / MUSCLE (Dodge Challenger) ────────────────────────────────────
  // Very long hood, low aggressive stance, fastback roofline sweeping to rear
  coupe:
    // Body (clockwise)
    'M14,68 L10,64 L10,58 L14,51 L20,44 L24,40 L28,36 L98,28 L112,20 L122,14 L130,12 L148,12 L166,22 L180,34 L185,44 L186,56 L186,63 L182,68 ' +
    'L170,68 Q155,57 140,68 L58,68 Q38,57 22,68 Z ' +
    // Windows (counter-clockwise)
    'M112,30 L147,30 L164,23 L148,13 L130,13 L120,15 Z',

  // ── SUV / CROSSOVER (Jeep Compass 4WD) ───────────────────────────────────
  // Shorter hood, tall upright greenhouse, squared-off liftgate rear
  suv:
    // Body (clockwise)
    'M14,68 L10,64 L10,52 L12,44 L18,36 L24,32 L28,30 L72,24 L86,16 L94,8 L102,6 L148,6 L160,8 L168,14 L174,22 L180,30 L184,44 L184,60 L180,64 L176,68 ' +
    'L166,68 Q152,54 138,68 L62,68 Q44,54 28,68 Z ' +
    // Windows (counter-clockwise)
    'M86,30 L162,30 L168,17 L148,7 L102,7 L94,16 Z',

  // ── PICKUP TRUCK ─────────────────────────────────────────────────────────
  // Medium hood, short cab, flat open bed rail visible at mid height
  truck:
    // Body (clockwise)
    'M14,68 L10,64 L10,52 L14,44 L18,38 L22,34 L26,32 L68,26 L84,16 L92,8 L100,6 L120,6 L132,10 L138,20 L140,30 L140,40 L182,40 L186,46 L186,60 L184,64 L180,68 ' +
    'L168,68 Q154,54 140,68 L62,68 Q40,54 24,68 Z ' +
    // Cab windows only (counter-clockwise)
    'M84,30 L130,30 L130,12 L120,8 L100,8 L92,18 Z',

  // ── VAN / MINIVAN ─────────────────────────────────────────────────────────
  // Cab-forward, near-vertical front, very tall and long greenhouse
  van:
    // Body (clockwise)
    'M12,68 L8,64 L8,52 L10,42 L14,34 L18,28 L24,24 L84,20 L96,10 L104,6 L158,6 L168,10 L178,20 L184,34 L184,56 L182,62 L178,68 ' +
    'L166,68 Q152,52 138,68 L62,68 Q42,52 28,68 Z ' +
    // Windows (counter-clockwise) — large glass area typical of minivans
    'M84,32 L160,32 L168,12 L158,7 L104,7 L96,12 Z',
};
