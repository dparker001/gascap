import type { Metadata, Viewport } from 'next';
import AuthProvider        from '@/components/AuthProvider';
import FeedbackButton      from '@/components/FeedbackButton';
import DarkModeProvider    from '@/components/DarkModeProvider';
import PullToRefresh       from '@/components/PullToRefresh';
import ErrorBoundary       from '@/components/ErrorBoundary';
import { LanguageProvider } from '@/contexts/LanguageContext';
import OneSignalProvider   from '@/components/OneSignalProvider';
import './globals.css';

const APP_URL = process.env.NEXTAUTH_URL ?? 'https://www.gascap.app';

export const metadata: Metadata = {
  title: 'GasCap™ — Free Gas Calculator | Know Before You Pull Up',
  description:
    'Free gas calculator that tells you exactly how much fuel you need and what it will cost before you reach the pump. Live local gas prices, rental car return mode, MPG tracking, and AI fuel advisor. No app store needed.',
  metadataBase: new URL(APP_URL),
  manifest: '/manifest.json',
  icons: { icon: '/favicon.svg', apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'GasCap™' },
  keywords: [
    'gas calculator',
    'fuel cost calculator',
    'how much gas do I need',
    'rental car gas calculator',
    'fuel calculator',
    'gas price calculator',
    'fill up calculator',
    'MPG tracker',
    'gas budget',
    'how much will it cost to fill my gas tank',
  ],

  // ── Open Graph (iMessage, WhatsApp, Facebook, LinkedIn) ──────────────────
  openGraph: {
    type:        'website',
    url:         APP_URL,
    siteName:    'GasCap™',
    title:       'GasCap™ — Know Before You Go',
    description: 'Calculate exactly how much fuel you need and what it will cost — before you pull up to the pump. Free, works offline, no account needed.',
    images: [
      {
        url:    '/og-image.png',
        width:  1200,
        height: 630,
        alt:    'GasCap™ — Know Before You Go',
      },
    ],
  },

  // ── Twitter / X card ─────────────────────────────────────────────────────
  twitter: {
    card:        'summary_large_image',
    title:       'GasCap™ — Know Before You Go',
    description: 'Calculate exactly how much fuel you need before you pull up to the pump. Free gas calculator + live local prices.',
    images:      ['/og-image.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#005F4A',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Apply dark class before first paint to avoid flash */}
        <DarkModeProvider />
        <LanguageProvider>
          <AuthProvider>
            <OneSignalProvider />
            <ErrorBoundary>
              <PullToRefresh />
              {children}
              <FeedbackButton />
            </ErrorBoundary>
          </AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
