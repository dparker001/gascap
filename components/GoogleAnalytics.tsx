'use client';

/**
 * GoogleAnalytics — loads the shared gtag.js library and configures both
 * Google Analytics 4 (GA_ID) and Google Ads (GADS_ID) on a single load.
 * GA4 also tracks SPA route changes. Renders whenever either ID is present.
 * Placed in the root layout so every page is covered.
 */

import Script        from 'next/script';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, Suspense }          from 'react';
import { GA_ID, GADS_ID } from '@/lib/gtag';
import { detectNativePlatform } from '@/hooks/useIsNative';

// Inner component that reads searchParams (must be wrapped in Suspense)
function PageViewTracker() {
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!GA_ID || typeof window === 'undefined' || !window.gtag) return;
    if (detectNativePlatform()) return;   // no GA4 pageview tracking in the native apps (App Store 5.1.2)
    const url = pathname + (searchParams.toString() ? `?${searchParams.toString()}` : '');
    window.gtag('config', GA_ID, { page_path: url });
  }, [pathname, searchParams]);

  return null;
}

export default function GoogleAnalytics() {
  // Render if EITHER product is configured. The Ads tag (GADS_ID) has a
  // hardcoded default, so conversion tracking works even without GA4.
  if (!GA_ID && !GADS_ID) return null;

  // Load the shared library once, using whichever ID is available.
  const loaderId = GA_ID || GADS_ID;

  return (
    <>
      {/* Load the shared gtag.js library (covers GA4 + Google Ads) */}
      <Script
        id="gtag-script"
        src={`https://www.googletagmanager.com/gtag/js?id=${loaderId}`}
        strategy="afterInteractive"
      />
      {/* Initialize gtag and configure each product */}
      <Script
        id="gtag-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            window.gtag = gtag;
            gtag('js', new Date());
            var __isNative = !!window.Capacitor || /[?&]native=(ios|android)/.test(location.search) || (document.referrer||'').indexOf('android-app://')===0 || (function(){try{var p=localStorage.getItem('gc_native_platform');return p==='ios'||p==='android';}catch(e){return false;}})();
            /* Native apps configure NO analytics/ads tags, so no GA/Ads cookies are
               set — keeps "Data Not Used to Track You" honest (App Store 5.1.2). */
            if (!__isNative) {
              ${GA_ID ? `gtag('config', '${GA_ID}', {
                page_location: window.location.href,
                page_title:    document.title,
                send_page_view: true,
              });` : ''}
              ${GADS_ID ? `gtag('config', '${GADS_ID}');` : ''}
            }
          `,
        }}
      />
      {/* Track soft navigations (Next.js App Router doesn't reload the page) */}
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
    </>
  );
}
