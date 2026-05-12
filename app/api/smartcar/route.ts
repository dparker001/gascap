/**
 * GET /api/smartcar
 * Returns the Smartcar OAuth connect URL for the current user.
 * Pro/Fleet only. Redirects to Smartcar Connect.
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { getAuthUrl }       from '@/lib/smartcar';
import { findById }         from '@/lib/users';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const uid  = session.user.id ?? session.user.email ?? '';
  const user = await findById(uid);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const isPro = user.plan === 'pro' || user.plan === 'fleet' || user.isProTrial;
  if (!isPro) return NextResponse.json({ error: 'Pro plan required for vehicle sync.' }, { status: 403 });

  try {
    const url = getAuthUrl(uid);
    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Smartcar not configured.';
    return NextResponse.json({ error: msg }, { status: 503 });
  }
}
