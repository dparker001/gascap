/**
 * Phase 4B — structural geometry checks for the two new curved gauge
 * renderers, using the same pattern as __tests__/gaugeVerticalBounds.test.ts:
 * this repo has no JSX render harness (vitest.config.ts has no
 * @vitejs/plugin-react), so components export their computed layout
 * constants and these tests assert them directly against the shared
 * viewBox bounds rather than claiming visual rendering is verified.
 *
 * Shared viewBox for every gauge renderer: "0 -20 280 165" → x ∈ [0, 280],
 * y ∈ [-20, 145].
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { VERTICAL_CURVED_NEEDLE_LAYOUT } from '@/components/gauge-styles/VerticalCurvedNeedle';
import { VERTICAL_CURVED_SEGMENTS_LAYOUT } from '@/components/gauge-styles/VerticalCurvedSegments';
import { GAUGE_STYLES } from '@/lib/gaugeStyles';
import { GAUGE_RENDERERS } from '@/components/gauge-styles/registry';

const verticalCurvedNeedleSrc = readFileSync(
  join(__dirname, '../components/gauge-styles/VerticalCurvedNeedle.tsx'),
  'utf8',
);

const VIEWBOX_X_MIN = 0, VIEWBOX_X_MAX = 280;
const VIEWBOX_Y_MIN = -20, VIEWBOX_Y_MAX = 145;
const TEXT_GLYPH_MARGIN = 4;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

describe('GAUGE_RENDERERS — both new keys resolve', () => {
  it('has exactly 6 renderer entries, one per canonical style', () => {
    expect(Object.keys(GAUGE_RENDERERS)).toHaveLength(6);
    for (const s of GAUGE_STYLES) expect(GAUGE_RENDERERS[s]).toBeTypeOf('function');
  });
});

describe('VerticalCurvedNeedle — geometry stays inside its own viewBox', () => {
  const L = VERTICAL_CURVED_NEEDLE_LAYOUT;
  // 2026-08-27 — this style's viewBox is taller than the other gauge
  // styles' shared "0 -20 280 165" (see the component's header comment), so
  // this block uses L.viewBox (exported by the component) instead of the
  // file-level VIEWBOX_* constants used below for VerticalCurvedSegments.

  it('E and F labels are inside this style\'s own (expanded) viewBox bounds', () => {
    for (const label of [L.eLabel, L.fLabel]) {
      expect(label.x).toBeGreaterThanOrEqual(L.viewBox.xMin);
      expect(label.x).toBeLessThanOrEqual(L.viewBox.xMax);
      expect(label.y).toBeGreaterThanOrEqual(L.viewBox.yMin + TEXT_GLYPH_MARGIN);
      expect(label.y).toBeLessThanOrEqual(L.viewBox.yMax - TEXT_GLYPH_MARGIN);
    }
  });

  it('the arc track (including its stroke width) stays within the viewBox at 0%, 50%, and 100%', () => {
    const halfTrack = L.trackWidth / 2;
    for (const pct of [0, 50, 100]) {
      const angle = L.startAngle + (L.endAngle - L.startAngle) * (pct / 100);
      const p = polar(L.cx, L.cy, L.r, angle);
      const outer = polar(L.cx, L.cy, L.r + halfTrack, angle);
      const inner = polar(L.cx, L.cy, L.r - halfTrack, angle);
      for (const point of [p, outer, inner]) {
        expect(point.x).toBeGreaterThanOrEqual(L.viewBox.xMin);
        expect(point.x).toBeLessThanOrEqual(L.viewBox.xMax);
        expect(point.y).toBeGreaterThanOrEqual(L.viewBox.yMin);
        expect(point.y).toBeLessThanOrEqual(L.viewBox.yMax);
      }
    }
  });

  it('the needle pivot itself is well inside the viewBox (not at an edge)', () => {
    expect(L.cx).toBeGreaterThan(L.viewBox.xMin);
    expect(L.cx).toBeLessThan(L.viewBox.xMax);
    expect(L.cy).toBeGreaterThan(L.viewBox.yMin);
    expect(L.cy).toBeLessThan(L.viewBox.yMax);
  });

  // 2026-08-27 — E/F previously sat at a radius close enough to the ¼/½/¾
  // labels that they read as extra scale marks rather than true endpoint
  // designators. These assert the actual reported symptom: F must sit
  // above (more negative y than) the topmost fractional label (¾), and E
  // must sit below (more positive y than) the bottommost fractional label
  // (¼) — not merely "somewhere in the viewBox."
  it('F sits above the uppermost fractional label (¾), E sits below the lowermost (¼)', () => {
    expect(L.fLabel.y).toBeLessThan(L.threeQuarterLabel.y);
    expect(L.eLabel.y).toBeGreaterThan(L.quarterLabel.y);
  });

  // E/F must stay on the LEFT side of the gauge (same side as the arc/
  // ticks), not drift toward the pivot or past it to the right — a
  // right-side placement was tried live and rejected as reading
  // disconnected from the gauge.
  it('E and F stay on the left side of the pivot, not shifted toward or past it', () => {
    for (const point of [L.eLabel, L.fLabel]) {
      expect(point.x).toBeLessThan(L.cx);
    }
  });

  // 2026-08-28 — live on-device testing showed F reading visually larger
  // than E even though the JSX already used the same literal fontSize/
  // fontWeight for both. Named, exported constants make "E and F share
  // identical typography" an explicit, testable invariant instead of an
  // easy-to-miss coincidence of two separate literals.
  it('E and F share identical endpoint label typography', () => {
    expect(L.endpointLabelFontSize).toBeTypeOf('number');
    expect(L.endpointLabelFontWeight).toBeTypeOf('number');
    const eText = verticalCurvedNeedleSrc.match(/<text[^>]*>E<\/text>/)?.[0] ?? '';
    const fText = verticalCurvedNeedleSrc.match(/<text[^>]*>F<\/text>/)?.[0] ?? '';
    expect(eText).toMatch(/fontSize=\{ENDPOINT_LABEL_FONT_SIZE\}/);
    expect(fText).toMatch(/fontSize=\{ENDPOINT_LABEL_FONT_SIZE\}/);
    expect(eText).toMatch(/fontWeight=\{ENDPOINT_LABEL_FONT_WEIGHT\}/);
    expect(fText).toMatch(/fontWeight=\{ENDPOINT_LABEL_FONT_WEIGHT\}/);
    expect(eText).toMatch(/textAnchor="middle"/);
    expect(fText).toMatch(/textAnchor="middle"/);
  });

  // 2026-08-27 regression — E/F previously sat at hardcoded coordinates
  // that were technically inside the viewBox (so the test above passed)
  // but were INSIDE the track's outer radius, visually overlapping the
  // gauge ring instead of reading as scale endpoints beyond it. "Inside
  // the viewBox" alone can never catch this class of bug — this asserts
  // the actual reported symptom: distance from the pivot must exceed the
  // track's outer edge.
  it('E and F sit strictly beyond the track\'s outer edge, not inside the ring', () => {
    const outerEdge = L.r + L.trackWidth / 2;
    for (const point of [L.eLabel, L.fLabel]) {
      const dist = Math.hypot(point.x - L.cx, point.y - L.cy);
      expect(dist).toBeGreaterThan(outerEdge);
    }
  });

  it('exposes 3 major ticks and 4 minor ticks — the required ⅛-fraction hierarchy (¼ ½ ¾ major, ⅛ ⅜ ⅝ ⅞ minor)', () => {
    expect(L.majorTicks).toEqual([0.25, 0.5, 0.75]);
    expect(L.minorTicks).toEqual([0.125, 0.375, 0.625, 0.875]);
  });

  it('the 90° sweep is oriented E-low-to-F-high (start angle < end angle)', () => {
    expect(L.startAngle).toBeLessThan(L.endAngle);
    expect(L.endAngle - L.startAngle).toBe(90);
  });

  // 2026-08-27 — major ticks previously recolored to near-white once the
  // fuel arc passed them (`frac <= p ? white : slate`), making the ¼/½/¾
  // scale landmarks visually disappear against the same-color filled arc.
  // No render harness exists in this repo (see file header), so this reads
  // the component source directly rather than mounting it — asserting both
  // that the fixed color constants exist and that no percent-conditional
  // tick coloring (the removed `filled`/`frac <= p` pattern) remains.
  it('major and minor ticks use a fixed color — not conditional on fuel percent', () => {
    expect(L.majorTickColor).toBeTypeOf('string');
    expect(L.minorTickColor).toBeTypeOf('string');
    expect(L.majorTickColor).not.toBe(L.minorTickColor);

    expect(verticalCurvedNeedleSrc).not.toMatch(/frac\s*<=\s*p\b/);
    expect(verticalCurvedNeedleSrc).not.toMatch(/filled\s*\?/);
  });
});

describe('VerticalCurvedSegments — geometry stays inside the shared viewBox', () => {
  const L = VERTICAL_CURVED_SEGMENTS_LAYOUT;

  it('E and F labels are inside the viewBox bounds', () => {
    for (const label of [L.eLabel, L.fLabel]) {
      expect(label.x).toBeGreaterThanOrEqual(VIEWBOX_X_MIN);
      expect(label.x).toBeLessThanOrEqual(VIEWBOX_X_MAX);
      expect(label.y).toBeGreaterThanOrEqual(VIEWBOX_Y_MIN + TEXT_GLYPH_MARGIN);
      expect(label.y).toBeLessThanOrEqual(VIEWBOX_Y_MAX - TEXT_GLYPH_MARGIN);
    }
  });

  it('exactly 8 segments — matches the shared ⅛-tank interaction grid', () => {
    expect(L.segmentCount).toBe(8);
  });

  it('every segment boundary stays within the viewBox at min/max radius (including stroke width)', () => {
    const halfWidth = L.segmentWidth / 2;
    const span = L.endAngle - L.startAngle;
    for (let i = 0; i <= L.segmentCount; i++) {
      const angle = L.startAngle + (span * i) / L.segmentCount;
      const outer = polar(L.cx, L.cy, L.r + halfWidth, angle);
      const inner = polar(L.cx, L.cy, L.r - halfWidth, angle);
      for (const point of [outer, inner]) {
        expect(point.x).toBeGreaterThanOrEqual(VIEWBOX_X_MIN);
        expect(point.x).toBeLessThanOrEqual(VIEWBOX_X_MAX);
        expect(point.y).toBeGreaterThanOrEqual(VIEWBOX_Y_MIN);
        expect(point.y).toBeLessThanOrEqual(VIEWBOX_Y_MAX);
      }
    }
  });

  it('is a curved arc (positive radius, 90° sweep) — recognizably different geometry from the straight vertical_segments bar', () => {
    expect(L.r).toBeGreaterThan(0);
    expect(L.endAngle - L.startAngle).toBe(90);
  });

  // 2026-08-27 regression — same root cause and same fix as
  // VerticalCurvedNeedle above.
  it('E and F sit strictly beyond the segment ring\'s outer edge, not inside the ring', () => {
    const outerEdge = L.r + L.segmentWidth / 2;
    for (const point of [L.eLabel, L.fLabel]) {
      const dist = Math.hypot(point.x - L.cx, point.y - L.cy);
      expect(dist).toBeGreaterThan(outerEdge);
    }
  });
});
