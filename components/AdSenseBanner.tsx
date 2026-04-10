'use client';

/**
 * AdSenseBanner — shown only to free-plan users.
 * Replace PUBLISHER_ID and SLOT_ID with real values from Google AdSense.
 * Set NEXT_PUBLIC_ADSENSE_PUBLISHER_ID env var to activate.
 * Leave unset (or empty) to hide the banner entirely (e.g. in dev).
 */
import Script from 'next/script';
import { useEffect, useRef } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';

interface AdSenseBannerProps {
  /** Ad slot ID from AdSense (e.g. "1234567890") */
  slotId?: string;
}

export default function AdSenseBanner({ slotId }: AdSenseBannerProps) {
  const { t } = useTranslation();
  const publisherId = process.env.NEXT_PUBLIC_ADSENSE_PUBLISHER_ID ?? '';
  const adRef = useRef<HTMLModElement>(null);

  useEffect(() => {
    if (!publisherId) return;
    try {
      // Push the ad after script loads
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({});
    } catch { /* adsbygoogle not ready yet */ }
  }, [publisherId]);

  // If no publisher ID configured, render nothing
  if (!publisherId) return null;

  return (
    <div className="w-full max-w-lg mx-auto px-4 py-2">
      <p className="text-[9px] text-slate-300 text-center mb-1 uppercase tracking-wider">{t.adSense.label}</p>
      <Script
        async
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisherId}`}
        crossOrigin="anonymous"
        strategy="lazyOnload"
      />
      <ins
        ref={adRef}
        className="adsbygoogle block w-full"
        style={{ display: 'block' }}
        data-ad-client={publisherId}
        data-ad-slot={slotId ?? ''}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
