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
    displayName:        user.displayName ?? '',
    phone:              user.phone       ?? '',
    smsOptIn:           user.smsOptIn    ?? false,
    avatarUrl:          (user as { avatarUrl?: string | null }).avatarUrl ?? '',
    preferredFillLevel: (user as { preferredFillLevel?: number | null }).preferredFillLevel ?? null,
    monthlyFuelBudget:  (user as { monthlyFuelBudget?: number | null }).monthlyFuelBudget   ?? null,
    userMode:           user.userMode ?? null,
  });
}

/** PATCH /api/user/profile — updates displayName, phone, smsOptIn, and/or avatarUrl */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json() as {
    displayName?:        string;
    phone?:              string;
    smsOptIn?:           boolean;
    avatarUrl?:          string | null;
    preferredFillLevel?: number | null;
    monthlyFuelBudget?:  number | null;
    userMode?:           string | null;
  };

  // Guard against oversized avatar payloads (base64 128×128 JPEG ≈ 10KB; 100KB is very generous)
  if (body.avatarUrl && body.avatarUrl.length > 100_000) {
    return NextResponse.json({ error: 'Avatar image too large' }, { status: 413 });
  }

  const userId = (session.user as { id?: string })?.id ?? '';

  // Detect first-time phone save to award 25 bonus giveaway entries.
  // Only granted once: phoneBonusEntries must still be 0 and the user
  // must be adding a non-empty phone number where none existed before.
  let phoneBonusEntries: number | undefined;
  if (body.phone && body.phone.trim()) {
    const existing = await findById(userId);
    if (existing && !existing.phone && (existing.phoneBonusEntries ?? 0) === 0) {
      phoneBonusEntries = 25;
    }
  }

  const VALID_MODES = ['personal', 'gig', 'rental', 'fleet'];
  const safeUserMode = body.userMode !== undefined
    ? (VALID_MODES.includes(body.userMode ?? '') ? body.userMode : null)
    : undefined;

  const updated = await updateUserProfile(userId, {
    displayName:        body.displayName,
    phone:              body.phone,
    smsOptIn:           body.smsOptIn,
    avatarUrl:          body.avatarUrl,
    preferredFillLevel: body.preferredFillLevel,
    monthlyFuelBudget:  body.monthlyFuelBudget,
    phoneBonusEntries,
    userMode:           safeUserMode,
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
