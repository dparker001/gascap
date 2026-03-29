import type { Metadata, Viewport } from 'next';
import AuthProvider from '@/components/AuthProvider';
import FeedbackButton from '@/components/FeedbackButton';
import './globals.css';

export const metadata: Metadata = {
  title: 'GasCap™ — Know Before You Go',
  description:
    'GasCap helps drivers quickly calculate how much fuel they need and what it will cost.',
  manifest: '/manifest.json',
  icons: { icon: '/favicon.svg', apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'GasCap' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#1e3a5f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          {children}
          <FeedbackButton />
        </AuthProvider>
      </body>
    </html>
  );
}
