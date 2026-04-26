'use client';

/**
 * GoogleAnalytics — loads GA4 and tracks SPA route changes.
 * Only renders when NEXT_PUBLIC_GA_MEASUREMENT_ID is set.
 * Placed in the root layout so every page is covered.
 */

import Script        from 'next/script';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, Suspense }          from 'react';
import { GA_ID }     from '@/lib/gtag';

// Inner component that reads searchParams (must be wrapped in Suspense)
function PageViewTracker() {
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!GA_ID || typeof window === 'undefined' || !window.gtag) return;
    const url = pathname + (searchParams.toString() ? `?${searchParams.toString()}` : '');
    window.gtag('config', GA_ID, { page_path: url });
  }, [pathname, searchParams]);

  return null;
}

export default function GoogleAnalytics() {
  if (!GA_ID) return null; // silently skip until ID is configured

  return (
    <>
      {/* Load the GA4 tag */}
      <Script
        id="ga4-script"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      {/* Initialize gtag */}
      <Script
        id="ga4-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            window.gtag = gtag;
            gtag('js', new Date());
            gtag('config', '${GA_ID}', {
              page_location: window.location.href,
              page_title:    document.title,
              send_page_view: true,
            });
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
