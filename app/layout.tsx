import type { Metadata, Viewport } from 'next';
import Script                from 'next/script';
import AuthProvider          from '@/components/AuthProvider';
import FeedbackButton        from '@/components/FeedbackButton';
import GHLChatWidget         from '@/components/GHLChatWidget';
import GoogleAnalytics       from '@/components/GoogleAnalytics';
import DarkModeProvider      from '@/components/DarkModeProvider';
import PullToRefresh         from '@/components/PullToRefresh';
import ErrorBoundary         from '@/components/ErrorBoundary';
import { LanguageProvider }  from '@/contexts/LanguageContext';
import OneSignalProvider     from '@/components/OneSignalProvider';
import GiveawayEntryToast    from '@/components/GiveawayEntryToast';
import './globals.css';

const APP_URL = 'https://www.gascap.app';

export const metadata: Metadata = {
  title: 'GasCap™ — Free Gas Calculator | Know Before You Pull Up',
  description:
    'Free gas calculator that tells you exactly how much fuel you need and what it will cost before you reach the pump. Live local gas prices, rental car return mode, MPG tracking, and AI fuel advisor. No app store needed.',
  metadataBase: new URL(APP_URL),
  manifest: '/manifest.json',
  icons: { icon: '/favicon.png?v=2', apple: '/apple-touch-icon.png?v=2' },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'GasCap™' },
  alternates: {
    canonical: APP_URL,
  },
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
        url:    '/og-image.png?v=2',
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
    images:      ['/og-image.png?v=2'],
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
        {/* ── Meta Pixel ───────────────────────────────────────────────────── */}
        <Script
          id="meta-pixel"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){
              n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
              if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];
              t=b.createElement(e);t.async=!0;t.src=v;
              s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
              (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
              fbq('init','948950298128395');
              fbq('track','PageView');
            `,
          }}
        />
        <noscript>
          <img
            height="1" width="1" style={{ display: 'none' }}
            src="https://www.facebook.com/tr?id=948950298128395&ev=PageView&noscript=1"
            alt=""
          />
        </noscript>
        {/* ── End Meta Pixel ───────────────────────────────────────────────── */}

        {/* ── Google Analytics 4 ───────────────────────────────────────────── */}
        <GoogleAnalytics />
        {/* ── End Google Analytics 4 ───────────────────────────────────────── */}

        {/* ── GHL Chat Widget (desktop only — not mounted on mobile) ──────── */}
        <GHLChatWidget />
        {/* ── End GHL Chat Widget ─────────────────────────────────────────── */}

        {/* Apply dark class before first paint to avoid flash */}
        <DarkModeProvider />
        <LanguageProvider>
          <AuthProvider>
            <OneSignalProvider />
            <GiveawayEntryToast />
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
