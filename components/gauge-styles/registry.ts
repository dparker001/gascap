import type { GaugeStyle } from '@/lib/gaugeStyles';
import AnalogNeedle from './AnalogNeedle';
import HorizontalSegments from './HorizontalSegments';
import VerticalSegments from './VerticalSegments';
import QuarterMarks from './QuarterMarks';
import type { GaugeRendererProps } from './types';

/** One place mapping each canonical GaugeStyle to its renderer component —
 *  used by both the interactive FuelGauge shell and the non-interactive
 *  GaugeStylePreview, so adding a style only means updating this file. */
export const GAUGE_RENDERERS: Record<GaugeStyle, (props: GaugeRendererProps) => JSX.Element> = {
  analog_needle:       AnalogNeedle,
  horizontal_segments: HorizontalSegments,
  vertical_segments:   VerticalSegments,
  quarter_marks:       QuarterMarks,
};
