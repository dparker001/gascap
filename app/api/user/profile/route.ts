import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { updateUserProfile } from '@/lib/users';
import { upsertGhlContact } from '@/lib/ghl';

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json() as { displayName?: string; phone?: string };
  const updated = updateUserProfile((session.user as { id?: string })?.id ?? '', {
    displayName: body.displayName,
    phone:       body.phone,
  });

  if (!updated) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Sync phone to GHL if provided
  if (body.phone) {
    upsertGhlContact({
      name:   updated.displayName || updated.name,
      email:  updated.email,
      phone:  body.phone,
      source: 'GasCap Profile Update',
    }).catch((e) => console.error('[GHL] profile sync failed:', e));
  }

  return NextResponse.json({ ok: true });
}
