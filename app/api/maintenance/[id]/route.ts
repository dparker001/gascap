/**
 * /api/maintenance/[id]
 * PATCH  — update a reminder (mark as serviced, edit intervals, etc.)
 * DELETE — remove a reminder
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { updateReminder, deleteReminder } from '@/lib/maintenance';

function userId(session: Awaited<ReturnType<typeof getServerSession>>) {
  const u = session?.user as { id?: string; email?: string } | undefined;
  return u?.id ?? u?.email ?? null;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const uid     = userId(session);
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body    = await req.json();
  const updated = updateReminder(uid, params.id, body);

  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ reminder: updated });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const uid     = userId(session);
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const deleted = deleteReminder(uid, params.id);
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
