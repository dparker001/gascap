import type { GaugeStyle } from '@/lib/gaugeStyles';
import AnalogNeedle from './AnalogNeedle';
import HorizontalSegments from './HorizontalSegments';
import VerticalSegments from './VerticalSegments';
import QuarterMarks from './QuarterMarks';
import VerticalCurvedNeedle from './VerticalCurvedNeedle';
import VerticalCurvedSegments from './VerticalCurvedSegments';
import type { GaugeRendererProps } from './types';

/** One place mapping each canonical GaugeStyle to its renderer component —
 *  used by both the interactive FuelGauge shell and the non-interactive
 *  GaugeStylePreview, so adding a style only means updating this file. */
export const GAUGE_RENDERERS: Record<GaugeStyle, (props: GaugeRendererProps) => JSX.Element> = {
  analog_needle:             AnalogNeedle,
  horizontal_segments:       HorizontalSegments,
  vertical_segments:         VerticalSegments,
  quarter_marks:             QuarterMarks,
  vertical_curved_needle:    VerticalCurvedNeedle,
  vertical_curved_segments:  VerticalCurvedSegments,
};
