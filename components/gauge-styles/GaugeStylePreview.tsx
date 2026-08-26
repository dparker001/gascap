'use client';

import type { GaugeStyle } from '@/lib/gaugeStyles';
import { GAUGE_RENDERERS } from './registry';

/**
 * Non-interactive preview of a gauge style — used by the vehicle and rental
 * "Change Gauge Style" pickers so the option a user taps looks pixel-
 * identical to the real interactive gauge (same renderer components,
 * same colors), without pulling in FuelGauge's drag/keyboard/nudge shell,
 * which has no place inside a small picker card.
 */
export default function GaugeStylePreview({ style, percent }: { style: GaugeStyle; percent: number }) {
  const Renderer = GAUGE_RENDERERS[style];
  const color = percent < 25 ? '#ef4444' : percent < 55 ? '#f59e0b' : '#22c55e';
  return (
    <div className="pointer-events-none">
      <Renderer percent={percent} color={color} dragging={false} label={`${percent}%`} />
    </div>
  );
}
