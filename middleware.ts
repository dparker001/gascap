import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Paths that never require verification
const BYPASS = [
  '/signin',
  '/signup',
  '/verify-email',
  '/admin',
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

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  // Not signed in — allow through (signin page handles unauthenticated users)
  if (!token) return NextResponse.next();

  // Signed in but email not verified — redirect to verify page
  if (!token.emailVerified) {
    const url = req.nextUrl.clone();
    url.pathname = '/verify-email';
    url.search   = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
