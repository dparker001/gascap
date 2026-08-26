/**
 * Post-release fix (2026-08-25) — the vertical gauge style's "E" label
 * rendered at y=148, three units past the shared viewBox's bottom edge
 * (viewBox "0 -20 280 165" → y ranges from -20 to 145), so it was silently
 * clipped by SVG's default overflow. This locks in that the bar and both
 * end labels stay inside that shared bounding box, with a real margin for
 * text glyphs (not just the mathematical boundary).
 *
 * This repo has no JSX/component-render test harness (no jsdom, no
 * @vitejs/plugin-react configured for vitest) — rather than adding that
 * infrastructure for one regression test, VerticalSegments.tsx exports its
 * actual computed layout values (VERTICAL_SEGMENTS_LAYOUT), and this test
 * asserts them directly against the shared viewBox bounds. This is tied to
 * the real constants used in the component's JSX, not a reimplementation.
 */
import { describe, it, expect } from 'vitest';
import { VERTICAL_SEGMENTS_LAYOUT } from '@/components/gauge-styles/VerticalSegments';

// Shared across every renderer — viewBox="0 -20 280 165".
const VIEWBOX_Y_MIN = -20;
const VIEWBOX_Y_MAX = 145; // -20 + 165
const TEXT_GLYPH_MARGIN = 4; // conservative allowance for cap-height/descender at fontSize 14

describe('VerticalSegments — bar and labels stay inside the shared viewBox', () => {
  it('the bar itself (top and bottom) is inside the viewBox', () => {
    expect(VERTICAL_SEGMENTS_LAYOUT.barTop).toBeGreaterThanOrEqual(VIEWBOX_Y_MIN);
    expect(VERTICAL_SEGMENTS_LAYOUT.barBottom).toBeLessThanOrEqual(VIEWBOX_Y_MAX);
  });

  it('the "F" label baseline has real margin above the viewBox top edge', () => {
    expect(VERTICAL_SEGMENTS_LAYOUT.fLabelY).toBeGreaterThanOrEqual(VIEWBOX_Y_MIN + TEXT_GLYPH_MARGIN);
  });

  it('the "E" label baseline has real margin below the viewBox bottom edge — the exact regression', () => {
    // The original bug: eLabelY was 148, three units past VIEWBOX_Y_MAX (145).
    expect(VERTICAL_SEGMENTS_LAYOUT.eLabelY).toBeLessThanOrEqual(VIEWBOX_Y_MAX - TEXT_GLYPH_MARGIN);
  });
});
