/**
 * Fuel-gauge geometry — converts localized gauge landmarks into a fuel percentage.
 *
 * The vision model is good at LOCATING points (needle tip, pivot, the E and F ends of
 * the scale) but weak at estimating the final ratio. So we let it localize, then do the
 * angle math here — deterministically — which is where the accuracy comes from.
 *
 * All points are normalized to 0..1 of the image (x = fraction of width, y = fraction of
 * height). `aspect` = imageWidth / imageHeight corrects the x-axis so angles aren't
 * distorted on non-square photos.
 */

export interface Pt { x: number; y: number; }

const toDeg = (r: number) => (r * 180) / Math.PI;

/** Wrap an angle to (-180, 180]. */
export function norm180(a: number): number {
  let x = a;
  while (x > 180) x -= 360;
  while (x <= -180) x += 360;
  return x;
}

/** Angle (deg, -180..180) of point `p` around `pivot`, aspect-corrected. */
export function angleAround(p: Pt, pivot: Pt, aspect: number): number {
  const dx = (p.x - pivot.x) * aspect;
  const dy = (p.y - pivot.y);
  return toDeg(Math.atan2(dy, dx));
}

export interface GeomResult {
  ok:          boolean;       // true only when a trustworthy percentage was derived
  percent:     number | null; // 0..100
  needleAngle: number | null;
  emptyAngle:  number | null;
  fullAngle:   number | null;
}

/**
 * Derive fuel % from the needle's angular position along the E→F arc.
 * Returns ok:false when landmarks are missing or the E/F span is too small to define
 * a scale (a sign the model mislocated them — better to fall back / ask for a retake).
 */
export function computeGaugePercent(
  pivot:     Pt | null,
  needleTip: Pt | null,
  empty:     Pt | null,
  full:      Pt | null,
  aspect:    number,
): GeomResult {
  if (!pivot || !needleTip || !empty || !full) {
    return { ok: false, percent: null, needleAngle: null, emptyAngle: null, fullAngle: null };
  }

  const emptyAngle  = angleAround(empty,     pivot, aspect);
  const fullAngle   = angleAround(full,      pivot, aspect);
  const needleAngle = angleAround(needleTip, pivot, aspect);

  // Signed shortest arc from E to F. Fuel gauges sweep well under 180°, so the
  // shortest arc is the real scale. Too small a span = mislocated endpoints.
  const sweep = norm180(fullAngle - emptyAngle);
  if (Math.abs(sweep) < 20) {
    return { ok: false, percent: null, needleAngle: Math.round(needleAngle), emptyAngle: Math.round(emptyAngle), fullAngle: Math.round(fullAngle) };
  }

  const fromE = norm180(needleAngle - emptyAngle);
  const frac  = Math.max(0, Math.min(1, fromE / sweep));

  return {
    ok:          true,
    percent:     Math.round(frac * 100),
    needleAngle: Math.round(needleAngle),
    emptyAngle:  Math.round(emptyAngle),
    fullAngle:   Math.round(fullAngle),
  };
}
