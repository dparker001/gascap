import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { findById, updateUserProfile } from '@/lib/users';
import { upsertGhlContact } from '@/lib/ghl';

/** GET /api/user/profile — returns current displayName and phone */
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = (session.user as { id?: string })?.id ?? '';
  const user   = await findById(userId);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  return NextResponse.json({
    displayName: user.displayName ?? '',
    phone:       user.phone       ?? '',
  });
}

/** PATCH /api/user/profile — updates displayName and/or phone */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body    = await req.json() as { displayName?: string; phone?: string };
  const userId  = (session.user as { id?: string })?.id ?? '';
  const updated = await updateUserProfile(userId, {
    displayName: body.displayName,
    phone:       body.phone,
  });

  if (!updated) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Sync to GHL if phone changed (fire-and-forget)
  if (body.phone !== undefined) {
    upsertGhlContact({
      name:   updated.displayName || updated.name,
      email:  updated.email,
      phone:  updated.phone ?? '',
      source: 'GasCap Profile Update',
    }).catch((e) => console.error('[GHL] profile sync failed:', e));
  }

  return NextResponse.json({ ok: true });
}
