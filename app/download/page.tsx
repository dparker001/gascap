import type { Metadata } from 'next';
import { Suspense } from 'react';
import DownloadPageClient from './DownloadPageClient';

const APP_URL = 'https://www.gascap.app';

export const metadata: Metadata = {
  title: 'Download GasCap™ | Know Before You Go',
  description:
    'Download GasCap™ and know what your fill-up may cost before you reach the pump. Find nearby gas prices, estimate fuel costs, manage vehicles, and make smarter fueling decisions.',
  alternates: { canonical: `${APP_URL}/download` },
  openGraph: {
    type:        'website',
    url:         `${APP_URL}/download`,
    siteName:    'GasCap™',
    title:       'Download GasCap™ | Know Before You Go',
    description: 'Know what your fill-up will cost before you ever reach the pump. Find nearby gas prices, calculate fuel costs, and manage vehicles — free.',
    images: [
      {
        url:    '/og-image.png?v=2',
        width:  1200,
        height: 630,
        alt:    'GasCap™ — Know Before You Go',
      },
    ],
  },
  twitter: {
    card:        'summary_large_image',
    title:       'Download GasCap™ | Know Before You Go',
    description: 'Know what your fill-up will cost before you ever reach the pump.',
    images:      ['/og-image.png?v=2'],
  },
};

export default function DownloadPage() {
  return (
    <Suspense fallback={null}>
      <DownloadPageClient />
    </Suspense>
  );
}
