import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

// Paths that never require verification
const BYPASS = [
  '/signin',
  '/signup',
  '/verify-email',
  '/admin',
  '/forgot-password',
  '/reset-password',
  '/terms',
  '/privacy',
  '/help',
  '/amoe',
  '/sweepstakes-rules',
  '/api/',
  '/gas/',
  '/_next/',
  '/favicon',
  '/icon',
  '/apple',
  '/manifest',
  '/sw.js',
  '/workbox',
  '/worker',
  '/public',
];

const GRACE_PERIOD_MS = 48 * 60 * 60 * 1000; // 48 hours

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow bypass paths
  if (BYPASS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // Enforce email verification for signed-in users past the 48-hour grace period
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (token && !token.emailVerified && token.createdAt) {
    const age = Date.now() - new Date(token.createdAt as string).getTime();
    if (age > GRACE_PERIOD_MS) {
      const url = req.nextUrl.clone();
      url.pathname = '/verify-email';
      url.search = '?locked=1';
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
