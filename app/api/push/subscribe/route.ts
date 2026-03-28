import { NextResponse }      from 'next/server';
import { getServerSession }  from 'next-auth';
import type { Session }      from 'next-auth';
import { authOptions }       from '@/lib/auth';
import { saveSub, removeSub } from '@/lib/pushSubscriptions';

function uid(session: Session | null): string {
  return (session?.user as { id?: string })?.id ?? session?.user?.email ?? '';
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sub = await req.json() as PushSubscriptionJSON;
  saveSub(uid(session), sub);
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  removeSub(uid(session));
  return NextResponse.json({ ok: true });
}
