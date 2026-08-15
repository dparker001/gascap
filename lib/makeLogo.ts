/**
 * Manufacturer logo URLs.
 * Source: filippofilip95/car-logos-dataset via jsDelivr CDN (387 brands, no
 * API key, no cost). Extracted from SavedVehicles so the Rental Return
 * Assistant can use the same proven source rather than duplicating it.
 *
 * Not every make resolves — callers must handle onError and fall back to
 * something (the garage uses a letter tile; rental uses a body silhouette).
 */

/** Overrides where the make name doesn't map cleanly to the dataset slug. */
const MAKE_SLUG_OVERRIDES: Record<string, string> = {
  'chevy':        'chevrolet',
  'vw':           'volkswagen',
  'mercedes':     'mercedes-benz',
  'alfa romeo':   'alfa-romeo',
  'land rover':   'land-rover',
  'aston martin': 'aston-martin',
};

export function getMakeLogoUrl(make: string): string {
  const key  = make.toLowerCase().trim();
  const slug = MAKE_SLUG_OVERRIDES[key] ?? key.replace(/\s+/g, '-');
  return `https://cdn.jsdelivr.net/gh/filippofilip95/car-logos-dataset@master/logos/thumb/${slug}.png`;
}
