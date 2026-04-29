import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { findById, updateUserProfile } from '@/lib/users';
import { upsertGhlContact, removeGhlTags } from '@/lib/ghl';

/** GET /api/user/profile — returns current displayName, phone, and smsOptIn */
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
    smsOptIn:    user.smsOptIn    ?? false,
  });
}

/** PATCH /api/user/profile — updates displayName, phone, and/or smsOptIn */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body   = await req.json() as { displayName?: string; phone?: string; smsOptIn?: boolean };
  const userId = (session.user as { id?: string })?.id ?? '';
  const updated = await updateUserProfile(userId, {
    displayName: body.displayName,
    phone:       body.phone,
    smsOptIn:    body.smsOptIn,
  });

  if (!updated) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Sync phone + SMS opt-in tag to GHL (fire-and-forget)
  const phoneChanged    = body.phone     !== undefined;
  const smsOptInChanged = body.smsOptIn  !== undefined;

  if (phoneChanged || smsOptInChanged) {
    const extraTags = updated.smsOptIn ? ['gascap-sms-optin'] : [];
    upsertGhlContact({
      name:      updated.displayName || updated.name,
      email:     updated.email,
      phone:     updated.phone ?? '',
      source:    'GasCap Profile Update',
      extraTags,
    }).catch((e) => console.error('[GHL] profile sync failed:', e));

    // If user opted out, remove the tag
    if (smsOptInChanged && !updated.smsOptIn) {
      removeGhlTags(updated.email, ['gascap-sms-optin'])
        .catch((e) => console.error('[GHL] sms opt-out tag remove failed:', e));
    }
  }

  return NextResponse.json({ ok: true });
}
