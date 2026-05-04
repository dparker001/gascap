import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { findById, updateUserProfile } from '@/lib/users';
import { upsertGhlContact, removeGhlTags } from '@/lib/ghl';

/** GET /api/user/profile — returns current displayName, phone, smsOptIn, and avatarUrl */
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
    avatarUrl:   (user as { avatarUrl?: string | null }).avatarUrl ?? '',
  });
}

/** PATCH /api/user/profile — updates displayName, phone, smsOptIn, and/or avatarUrl */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json() as {
    displayName?: string;
    phone?:       string;
    smsOptIn?:    boolean;
    avatarUrl?:   string | null;
  };

  // Guard against oversized avatar payloads (base64 128×128 JPEG ≈ 10KB; 100KB is very generous)
  if (body.avatarUrl && body.avatarUrl.length > 100_000) {
    return NextResponse.json({ error: 'Avatar image too large' }, { status: 413 });
  }

  const userId  = (session.user as { id?: string })?.id ?? '';
  const updated = await updateUserProfile(userId, {
    displayName: body.displayName,
    phone:       body.phone,
    smsOptIn:    body.smsOptIn,
    avatarUrl:   body.avatarUrl,
  });

  if (!updated) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Sync phone + SMS opt-in tag to GHL (fire-and-forget)
  const phoneChanged    = body.phone    !== undefined;
  const smsOptInChanged = body.smsOptIn !== undefined;

  if (phoneChanged || smsOptInChanged) {
    const extraTags = updated.smsOptIn ? ['gascap-sms-optin'] : [];
    upsertGhlContact({
      name:      updated.displayName || updated.name,
      email:     updated.email,
      phone:     updated.phone ?? '',
      source:    'GasCap Profile Update',
      extraTags,
    }).catch((e) => console.error('[GHL] profile sync failed:', e));

    if (smsOptInChanged && !updated.smsOptIn) {
      removeGhlTags(updated.email, ['gascap-sms-optin'])
        .catch((e) => console.error('[GHL] sms opt-out tag remove failed:', e));
    }
  }

  return NextResponse.json({ ok: true });
}
