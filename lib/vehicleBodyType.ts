/**
 * Vehicle body-type inference — drives the silhouette icon shown for a
 * rental vehicle.
 *
 * IMPORTANT: this is a cosmetic inference, not authoritative vehicle data.
 * It exists because a RentalSession only reliably stores make/model/trim +
 * tank size — the VIN path can supply an NHTSA bodyClass, but the
 * Year/Make/Model and manual-entry paths cannot, and every rental needs an
 * icon. Never use this for anything that affects a fuel calculation; it
 * only picks which picture to draw.
 *
 * Priority: explicit NHTSA bodyClass (when a VIN gave us one) → model-name
 * keyword → tank-capacity heuristic → generic car.
 */

export type VehicleBodyType = 'compact' | 'sedan' | 'suv' | 'pickup' | 'van';


// Common rental-fleet models by body type. Deliberately not exhaustive —
// anything unmatched falls through to the tank-size heuristic, which is a
// reasonable guess for the long tail.
const MODEL_KEYWORDS: Array<{ type: VehicleBodyType; keywords: string[] }> = [
  { type: 'pickup', keywords: [
    'f-150', 'f150', 'f-250', 'f250', 'silverado', 'sierra', 'ram 1500', 'ram 2500',
    'tacoma', 'tundra', 'ranger', 'colorado', 'canyon', 'frontier', 'ridgeline',
    'titan', 'maverick', 'gladiator',
  ] },
  { type: 'van', keywords: [
    'pacifica', 'odyssey', 'sienna', 'carnival', 'caravan', 'voyager', 'sedona',
    'transit', 'sprinter', 'promaster', 'express', 'savana', 'metris', 'nv200',
  ] },
  { type: 'suv', keywords: [
    'explorer', 'tahoe', 'suburban', 'highlander', 'pilot', 'traverse', 'equinox',
    'rav4', 'cr-v', 'crv', 'rogue', 'escape', 'edge', 'expedition', 'yukon',
    'telluride', 'palisade', 'atlas', 'pathfinder', 'murano', '4runner', 'bronco',
    'wrangler', 'cherokee', 'terrain', 'blazer', 'trailblazer', 'encore', 'envision',
    'tucson', 'santa fe', 'sportage', 'sorento', 'seltos', 'cx-5', 'cx-9', 'cx-50',
    'outback', 'forester', 'ascent', 'mdx', 'rdx', 'xt5', 'durango', 'compass',
    'renegade', 'kicks', 'venue', 'trax', 'corsair', 'nautilus', 'aviator',
    'navigator', 'escalade', 'grand cherokee', 'bronco sport', 'crosstrek',
  ] },
  { type: 'compact', keywords: [
    'versa', 'mirage', 'spark', 'rio', 'accent', 'yaris', 'fit', 'sonic', 'fiesta',
  ] },
  { type: 'sedan', keywords: [
    'camry', 'accord', 'altima', 'malibu', 'sonata', 'elantra', 'civic', 'corolla',
    'sentra', 'jetta', 'passat', 'fusion', 'impala', 'charger', 'chrysler 300',
    'k5', 'forte', 'legacy', 'mazda3', 'mazda6', 'maxima', 'avalon', 'stinger',
  ] },
];

/** Maps an NHTSA bodyClass string (from a VIN decode) to a body type. */
function fromBodyClass(bodyClass: string): VehicleBodyType | null {
  const lower = bodyClass.toLowerCase();
  if (lower.includes('pickup') || lower.includes('truck'))        return 'pickup';
  if (lower.includes('van') || lower.includes('minivan'))         return 'van';
  if (lower.includes('sport utility') || lower.includes('suv')
      || lower.includes('crossover') || lower.includes('multipurpos')) return 'suv';
  if (lower.includes('hatch') || lower.includes('compact'))       return 'compact';
  if (lower.includes('sedan') || lower.includes('saloon')
      || lower.includes('coupe') || lower.includes('convertible')) return 'sedan';
  return null;
}

function fromModelName(model: string): VehicleBodyType | null {
  const lower = model.toLowerCase().trim();
  if (!lower) return null;
  for (const entry of MODEL_KEYWORDS) {
    if (entry.keywords.some((k) => lower.includes(k))) return entry.type;
  }
  return null;
}

/** Weak last-resort guess — tank sizes overlap between classes, so this is
 *  only reached when neither bodyClass nor the model name matched. */
function fromTankSize(gallons: number): VehicleBodyType {
  if (gallons < 12)   return 'compact';
  if (gallons < 16)   return 'sedan';
  if (gallons < 21)   return 'suv';
  if (gallons < 25)   return 'van';
  return 'pickup';
}

export function inferBodyType(input: {
  model?:      string | null;
  tankGallons?: number | null;
  bodyClass?:  string | null;
}): VehicleBodyType {
  if (input.bodyClass) {
    const fromClass = fromBodyClass(input.bodyClass);
    if (fromClass) return fromClass;
  }
  if (input.model) {
    const fromModel = fromModelName(input.model);
    if (fromModel) return fromModel;
  }
  if (input.tankGallons != null && input.tankGallons > 0) {
    return fromTankSize(input.tankGallons);
  }
  return 'sedan';
}
