/**
 * POST /api/native/push-token
 *
 * Called by the native iOS (Capacitor) wrapper after it registers for push
 * notifications. Stores the APNs device token on the signed-in user so the
 * server can send native push (e.g. price-drop alerts) to their iPhone.
 *
 * Auth: the user's NextAuth session (the wrapper loads the live site signed-in).
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { setIosPushToken } from '@/lib/users';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body  = await req.json().catch(() => ({})) as { token?: string };
  const token = (body.token ?? '').trim();
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

  try {
    await setIosPushToken(userId, token);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[push-token] store failed:', e);
    return NextResponse.json({ error: 'Failed to store token' }, { status: 500 });
  }
}
