/**
 * Local lat/lng → US state code. NO network call (replaces the Nominatim
 * reverse-geocode that made /api/gas-price slow + unreliable — Nominatim's free
 * server rate-limits server-side traffic, causing the "spins forever" bug).
 *
 * Method: point-in-bounding-box, tie-broken by nearest state centroid. Bounding
 * boxes are approximate, so a point right on a jagged border can resolve to a
 * neighbor — fine for STATE-AVERAGE gas prices (the user can always edit the
 * pre-filled number). Interior points (the vast majority) resolve correctly.
 *
 * Returns a 2-letter state code, or 'US' when the point is clearly outside the
 * 50 states (→ national average upstream).
 */

interface StateBox {
  code: string;
  // [minLat, maxLat, minLng, maxLng]
  bbox: [number, number, number, number];
  // approximate geographic centroid [lat, lng]
  c:    [number, number];
}

// 50 states + DC. Bounds in decimal degrees (approximate).
const STATES: StateBox[] = [
  { code: 'AL', bbox: [30.2, 35.01, -88.5, -84.89],  c: [32.8, -86.8] },
  { code: 'AZ', bbox: [31.33, 37.0, -114.82, -109.04], c: [34.3, -111.7] },
  { code: 'AR', bbox: [33.0, 36.5, -94.62, -89.64],  c: [34.8, -92.4] },
  { code: 'CA', bbox: [32.53, 42.01, -124.48, -114.13], c: [37.2, -119.5] },
  { code: 'CO', bbox: [36.99, 41.01, -109.06, -102.04], c: [39.0, -105.5] },
  { code: 'CT', bbox: [40.95, 42.05, -73.73, -71.79], c: [41.6, -72.7] },
  { code: 'DE', bbox: [38.45, 39.84, -75.79, -75.05], c: [39.0, -75.5] },
  { code: 'DC', bbox: [38.79, 39.0, -77.12, -76.91],  c: [38.9, -77.03] },
  { code: 'FL', bbox: [24.5, 31.0, -87.63, -80.03],   c: [28.6, -82.4] },
  { code: 'GA', bbox: [30.36, 35.0, -85.61, -80.84],  c: [32.6, -83.4] },
  { code: 'ID', bbox: [42.0, 49.0, -117.24, -111.04], c: [44.4, -114.6] },
  { code: 'IL', bbox: [36.97, 42.51, -91.51, -87.5],  c: [40.0, -89.2] },
  { code: 'IN', bbox: [37.77, 41.76, -88.1, -84.78],  c: [39.9, -86.3] },
  { code: 'IA', bbox: [40.38, 43.5, -96.64, -90.14],  c: [42.0, -93.5] },
  { code: 'KS', bbox: [36.99, 40.01, -102.05, -94.6], c: [38.5, -98.4] },
  { code: 'KY', bbox: [36.5, 39.15, -89.57, -81.96],  c: [37.5, -85.3] },
  { code: 'LA', bbox: [28.9, 33.02, -94.04, -88.8],   c: [31.0, -92.0] },
  { code: 'ME', bbox: [43.06, 47.46, -71.08, -66.95], c: [45.4, -69.2] },
  { code: 'MD', bbox: [37.9, 39.72, -79.49, -75.05],  c: [39.0, -76.8] },
  { code: 'MA', bbox: [41.24, 42.89, -73.51, -69.93], c: [42.3, -71.8] },
  { code: 'MI', bbox: [41.7, 48.31, -90.42, -82.41],  c: [44.3, -85.6] },
  { code: 'MN', bbox: [43.5, 49.38, -97.24, -89.49],  c: [46.3, -94.3] },
  { code: 'MS', bbox: [30.17, 35.0, -91.66, -88.1],   c: [32.7, -89.7] },
  { code: 'MO', bbox: [36.0, 40.61, -95.77, -89.1],   c: [38.4, -92.5] },
  { code: 'MT', bbox: [44.36, 49.0, -116.05, -104.04], c: [47.0, -109.6] },
  { code: 'NE', bbox: [40.0, 43.0, -104.05, -95.31],  c: [41.5, -99.8] },
  { code: 'NV', bbox: [35.0, 42.0, -120.01, -114.04], c: [39.3, -116.6] },
  { code: 'NH', bbox: [42.7, 45.31, -72.56, -70.6],   c: [43.7, -71.6] },
  { code: 'NJ', bbox: [38.93, 41.36, -75.56, -73.89], c: [40.1, -74.5] },
  { code: 'NM', bbox: [31.33, 37.0, -109.05, -103.0], c: [34.4, -106.1] },
  { code: 'NY', bbox: [40.5, 45.02, -79.76, -71.86],  c: [42.9, -75.5] },
  { code: 'NC', bbox: [33.84, 36.59, -84.32, -75.46], c: [35.5, -79.4] },
  { code: 'ND', bbox: [45.94, 49.0, -104.05, -96.55], c: [47.5, -100.3] },
  { code: 'OH', bbox: [38.4, 42.32, -84.82, -80.52],  c: [40.2, -82.8] },
  { code: 'OK', bbox: [33.62, 37.0, -103.0, -94.43],  c: [35.5, -97.5] },
  { code: 'OR', bbox: [41.99, 46.29, -124.57, -116.46], c: [44.0, -120.5] },
  { code: 'PA', bbox: [39.72, 42.27, -80.52, -74.69], c: [41.0, -77.8] },
  { code: 'RI', bbox: [41.15, 42.02, -71.86, -71.12], c: [41.7, -71.5] },
  { code: 'SC', bbox: [32.03, 35.22, -83.35, -78.54], c: [33.9, -80.9] },
  { code: 'SD', bbox: [42.48, 45.94, -104.06, -96.44], c: [44.4, -100.2] },
  { code: 'TN', bbox: [34.98, 36.68, -90.31, -81.65], c: [35.8, -86.4] },
  { code: 'TX', bbox: [25.84, 36.5, -106.65, -93.51], c: [31.5, -99.3] },
  { code: 'UT', bbox: [37.0, 42.0, -114.05, -109.04], c: [39.3, -111.7] },
  { code: 'VT', bbox: [42.73, 45.02, -73.44, -71.46], c: [44.0, -72.7] },
  { code: 'VA', bbox: [36.54, 39.47, -83.68, -75.24], c: [37.5, -78.8] },
  { code: 'WA', bbox: [45.54, 49.0, -124.85, -116.92], c: [47.4, -120.4] },
  { code: 'WV', bbox: [37.2, 40.64, -82.64, -77.72],  c: [38.6, -80.6] },
  { code: 'WI', bbox: [42.49, 47.31, -92.89, -86.8],  c: [44.6, -89.9] },
  { code: 'WY', bbox: [41.0, 45.01, -111.06, -104.05], c: [43.0, -107.5] },
  // Non-contiguous
  { code: 'AK', bbox: [51.2, 71.5, -179.9, -129.9],   c: [64.0, -152.0] },
  { code: 'HI', bbox: [18.9, 22.25, -160.3, -154.8],  c: [20.7, -156.3] },
];

function dist2(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = aLat - bLat;
  const dLng = aLng - bLng;
  return dLat * dLat + dLng * dLng;
}

export function usStateFromCoords(lat: number, lng: number): string {
  if (!isFinite(lat) || !isFinite(lng)) return 'US';

  // Coarse "is this even in/near the US?" guard so a point abroad doesn't get
  // snapped to the nearest state centroid → national average instead.
  const inContiguous = lat >= 24 && lat <= 49.5 && lng >= -125.5 && lng <= -66.5;
  const inAlaska     = lat >= 51 && lat <= 71.6 && lng >= -180 && lng <= -129.5;
  const inHawaii     = lat >= 18.5 && lat <= 22.4 && lng >= -160.5 && lng <= -154.5;
  if (!inContiguous && !inAlaska && !inHawaii) return 'US';

  // 1) Bounding-box matches, tie-broken by "deepest inside the box" (max distance
  //    to the nearest box edge). Beats nearest-centroid for big states whose
  //    centroid is far from a populated edge — e.g. NYC sits inside NY's box but
  //    nearer NJ's centroid; interior-depth correctly keeps it in NY.
  let best: string | null = null;
  let bestDepth = -Infinity;
  for (const s of STATES) {
    const [minLat, maxLat, minLng, maxLng] = s.bbox;
    if (lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng) {
      const depth = Math.min(lat - minLat, maxLat - lat, lng - minLng, maxLng - lng);
      if (depth > bestDepth) { bestDepth = depth; best = s.code; }
    }
  }
  if (best) return best;

  // 2) No bbox hit (near a border / coastline) → globally nearest centroid.
  let bestD = Infinity;
  for (const s of STATES) {
    const d = dist2(lat, lng, s.c[0], s.c[1]);
    if (d < bestD) { bestD = d; best = s.code; }
  }
  return best ?? 'US';
}
