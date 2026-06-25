import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { findById, updateUserProfile } from '@/lib/users';
import { pgPool }           from '@/lib/prisma';
import { upsertGhlContact } from '@/lib/ghl';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body  = await req.json() as { phone?: string; code?: string };
  const phone = (body.phone ?? '').trim();
  const code  = (body.code  ?? '').trim();

  if (!phone || !code) {
    return NextResponse.json({ error: 'Phone and code are required.' }, { status: 400 });
  }

  // Read + consume OTP from DB
  const { rows } = await pgPool.query<{ code: string; expires: Date }>(
    `SELECT code, expires FROM "OtpCode" WHERE email=$1 LIMIT 1`,
    [`phone:${phone}`],
  );
  const entry = rows[0];
  if (!entry || entry.code !== code) {
    return NextResponse.json({ error: 'Invalid or expired code. Please try again.' }, { status: 400 });
  }
  if (new Date() > new Date(entry.expires)) {
    await pgPool.query(`DELETE FROM "OtpCode" WHERE email=$1`, [`phone:${phone}`]);
    return NextResponse.json({ error: 'Code expired. Please request a new one.' }, { status: 400 });
  }
  await pgPool.query(`DELETE FROM "OtpCode" WHERE email=$1`, [`phone:${phone}`]);

  // Save phone + smsOptIn to DB
  const userId = (session.user as { id?: string })?.id ?? '';
  const user   = await findById(userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const isFirstPhone = !user.phone && (user.phoneBonusEntries ?? 0) === 0;

  await updateUserProfile(userId, {
    phone,
    smsOptIn: true,
    ...(isFirstPhone ? { phoneBonusEntries: 25 } : {}),
  });

  // Sync to GHL with sms-optin tag (fire-and-forget)
  upsertGhlContact({
    name:      user.displayName || user.name,
    email:     user.email,
    phone,
    source:    'GasCap Phone Verify',
    extraTags: ['gascap-sms-optin'],
  }).catch((e) => console.error('[GHL] phone verify sync failed:', e));

  return NextResponse.json({ ok: true });
}
