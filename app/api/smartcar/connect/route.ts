import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { buildConnectUrl } from '@/lib/smartcar';
import { findById } from '@/lib/users';
import { randomBytes } from 'crypto';

// GET /api/smartcar/connect
// Generates the Smartcar OAuth URL and redirects the user.
// Pro/Annual/Lifetime only. Starts a 14-day trial on first connect.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as { id?: string }).id ?? '';
  const user   = await findById(userId);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const plan = user.plan ?? 'free';
  if (plan === 'free') {
    return NextResponse.json({ error: 'Connected Car requires a Pro plan' }, { status: 403 });
  }

  // state = userId:nonce (verified in callback to prevent CSRF)
  const nonce = randomBytes(16).toString('hex');
  const state = `${userId}:${nonce}`;

  const url = buildConnectUrl(state);
  return NextResponse.redirect(url);
}
