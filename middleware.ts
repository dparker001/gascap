import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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
  '/api/',
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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow bypass paths
  if (BYPASS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // All routes are accessible — email verification is handled via an inline
  // banner on the homepage rather than a hard redirect, so users can use the
  // app while their email is pending verification.
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
