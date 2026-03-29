import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Pages that don't require email verification
const PUBLIC_PATHS = [
  '/signin',
  '/signup',
  '/verify-email',
  '/api/auth',
  '/api/auth/register',
  '/api/auth/verify-email',
  '/_next',
  '/favicon',
  '/icon',
  '/apple',
  '/manifest',
  '/sw.js',
  '/workbox',
  '/worker',
];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

export default withAuth(
  function middleware(req: NextRequest & { nextauth?: { token?: Record<string, unknown> } }) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth?.token as {
      emailVerified?: boolean;
      email?: string;
    } | null;

    // Not signed in — let NextAuth handle it
    if (!token) return NextResponse.next();

    // Signed in but not verified — redirect to verify-email page
    if (!token.emailVerified && !isPublic(pathname)) {
      const url = req.nextUrl.clone();
      url.pathname = '/verify-email';
      url.search = '';
      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      // Run middleware for all routes (authorized: true lets the middleware function decide)
      authorized: () => true,
    },
  },
);

export const config = {
  matcher: [
    /*
     * Match all paths except static files and images
     */
    '/((?!_next/static|_next/image|public|favicon.ico).*)',
  ],
};
