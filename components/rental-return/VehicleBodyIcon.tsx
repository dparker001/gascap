'use client';

/**
 * Side-profile silhouette for a rental vehicle's body type. Purely
 * decorative — see lib/vehicleBodyType.ts for why the type is inferred
 * rather than authoritative. `currentColor` throughout so the caller
 * controls the color.
 */

import type { VehicleBodyType } from '@/lib/vehicleBodyType';

const PATHS: Record<VehicleBodyType, string> = {
  // Deliberately narrower and lower than `sedan` — at icon size a compact and
  // a sedan share a silhouette, so overall footprint is what distinguishes
  // them. Steep hatchback rear rather than a trunk shelf.
  compact:
    'M4.4 15.6h15.2M6.8 15.6a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M14.2 15.6a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0'
    + 'M4.1 15.6v-2.1c0-.6.4-1.1.9-1.2l1.7-.4 1.7-2.4c.3-.5.9-.8 1.5-.8h3.1c.6 0 1.1.3 1.4.7l1.8 2.5 2 .4c.5.1.9.6.9 1.2v2.1',
  // Three-box profile, longer trunk
  sedan:
    'M2.5 15.6h19M5.4 15.6a1.7 1.7 0 1 0 3.4 0 1.7 1.7 0 1 0-3.4 0M15.4 15.6a1.7 1.7 0 1 0 3.4 0 1.7 1.7 0 1 0-3.4 0'
    + 'M2.2 15.6v-2.5c0-.7.5-1.2 1.1-1.4l2.6-.6 2.3-2.7c.4-.5 1-.8 1.7-.8h4.4c.7 0 1.3.3 1.7.8l2.4 2.7 2.6.6c.6.2 1.1.7 1.1 1.4v2.5',
  // Taller greenhouse, higher ride height
  suv:
    'M2.5 16h19M5.4 16a1.7 1.7 0 1 0 3.4 0 1.7 1.7 0 1 0-3.4 0M15.4 16a1.7 1.7 0 1 0 3.4 0 1.7 1.7 0 1 0-3.4 0'
    + 'M2.2 16v-3.6c0-.7.5-1.3 1.1-1.4l1.9-.4 1.9-3.1c.3-.5.9-.9 1.6-.9h6.9c.6 0 1.2.3 1.6.8l2.2 3.2 1.9.4c.6.1 1.1.7 1.1 1.4V16'
    + 'M6.6 10.6h10.8',
  // Cab + open bed
  pickup:
    'M2.5 16h19M5.4 16a1.7 1.7 0 1 0 3.4 0 1.7 1.7 0 1 0-3.4 0M15.4 16a1.7 1.7 0 1 0 3.4 0 1.7 1.7 0 1 0-3.4 0'
    + 'M2.2 16v-3.4c0-.7.5-1.3 1.1-1.4l1.7-.4 1.9-3.1c.3-.5.9-.9 1.6-.9h4c.6 0 1.2.3 1.5.8l1.9 3.1h1'
    + 'M13.2 11.1h8.6v4.9M13.2 8.2v2.9',
  // Tall, boxy, long roofline
  van:
    'M2.5 16h19M5.4 16a1.7 1.7 0 1 0 3.4 0 1.7 1.7 0 1 0-3.4 0M15.4 16a1.7 1.7 0 1 0 3.4 0 1.7 1.7 0 1 0-3.4 0'
    + 'M2.2 16V8.6c0-.8.6-1.4 1.4-1.4h11.1c.5 0 1 .2 1.3.7l3.3 4.1c.3.3.5.8.5 1.2V16'
    + 'M6.4 10.5h7.9M14.3 7.2v3.3',
};

export default function VehicleBodyIcon({
  bodyType,
  className = 'w-8 h-8',
}: {
  bodyType: VehicleBodyType;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[bodyType]} />
    </svg>
  );
}
