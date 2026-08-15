'use client';

/**
 * Vehicle visual for a rental — the manufacturer's logo when we can resolve
 * it (instantly recognizable, and it's the real brand rather than a generic
 * outline), falling back to the inferred body-type silhouette when the make
 * is missing or isn't in the logo dataset.
 *
 * Real vehicle *photography* would need a licensed image API (Imagin.studio,
 * Evox, Chrome Data) — paid, keyed, and ToS-restricted. The brand logo is
 * free, already proven elsewhere in this app, and reads better at this size.
 */

import { useState } from 'react';
import { getMakeLogoUrl } from '@/lib/makeLogo';
import type { VehicleBodyType } from '@/lib/vehicleBodyType';
import VehicleBodyIcon from './VehicleBodyIcon';

export default function RentalVehicleAvatar({
  make,
  bodyType,
  size = 'md',
}: {
  make?: string | null;
  bodyType: VehicleBodyType;
  size?: 'md' | 'lg';
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const showLogo = !!make?.trim() && !logoFailed;

  const box  = size === 'lg' ? 'w-14 h-14' : 'w-11 h-11';
  const img  = size === 'lg' ? 'w-9 h-9'   : 'w-7 h-7';
  const icon = size === 'lg' ? 'w-8 h-8'   : 'w-7 h-7';

  return (
    <div className={`${box} flex-shrink-0 rounded-2xl bg-white flex items-center justify-center shadow-sm overflow-hidden`}>
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={getMakeLogoUrl(make!)}
          alt={`${make} logo`}
          loading="lazy"
          className={`${img} object-contain`}
          onError={() => setLogoFailed(true)}
        />
      ) : (
        <VehicleBodyIcon bodyType={bodyType} className={`${icon} text-blue-700`} />
      )}
    </div>
  );
}
