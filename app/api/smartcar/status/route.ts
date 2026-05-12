/**
 * GET /api/smartcar/status
 * Returns the current user's Smartcar add-on and connection status.
 * Used by SmartcarConnect to decide which panel to show.
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { findById }         from '@/lib/users';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const uid  = session.user.id ?? session.user.email ?? '';
  const user = await findById(uid);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const isPro          = user.plan === 'pro' || user.plan === 'fleet' || (user.isProTrial ?? false);
  const addonActive    = user.smartcarAddonActive ?? false;
  const hasOAuthTokens = !!(user.smartcarRefreshToken);

  return NextResponse.json({
    isPro,
    addonActive,
    hasOAuthTokens,
    // Caller doesn't need the actual tokens — just whether they exist
  });
}
