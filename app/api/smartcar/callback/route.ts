/**
 * GET /api/smartcar/callback?code=xxx&state=userId
 * OAuth callback — exchanges code for tokens, stores on User, then redirects
 * back to the app with ?smartcarConnected=1 so the garage UI can show a success state.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { exchangeCode }                   from '@/lib/smartcar';
import { prisma }                         from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get('code');
  const state = searchParams.get('state');  // userId passed as state
  const error = searchParams.get('error');

  // User denied or Smartcar returned an error
  if (error) {
    const reason = searchParams.get('error_description') ?? error;
    return NextResponse.redirect(new URL(`/?smartcarError=${encodeURIComponent(reason)}`, req.url));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/?smartcarError=missing_params', req.url));
  }

  try {
    const tokens = await exchangeCode(code);

    // Store tokens on the user record
    await prisma.user.update({
      where: { id: state },
      data: {
        smartcarAccessToken:  tokens.accessToken,
        smartcarRefreshToken: tokens.refreshToken,
        smartcarTokenExpiry:  tokens.expiry,
      },
    });

    // Redirect back to app — the main page will show the garage with a linking prompt
    return NextResponse.redirect(new URL('/?smartcarConnected=1', req.url));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Token exchange failed.';
    console.error('[GasCap] Smartcar callback error:', e);
    return NextResponse.redirect(new URL(`/?smartcarError=${encodeURIComponent(msg)}`, req.url));
  }
}
