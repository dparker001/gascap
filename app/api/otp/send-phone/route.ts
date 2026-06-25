import { NextResponse }      from 'next/server';
import { getServerSession }  from 'next-auth';
import { authOptions }       from '@/lib/auth';
import { findById }          from '@/lib/users';
import { pgPool }            from '@/lib/prisma';
import { sendGhlSmsToPhone } from '@/lib/ghl';

function generateCode(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1_000_000).padStart(6, '0');
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body  = await req.json() as { phone?: string };
  const phone = (body.phone ?? '').trim();
  if (!phone) {
    return NextResponse.json({ error: 'Phone number is required.' }, { status: 400 });
  }

  const userId = (session.user as { id?: string })?.id ?? '';
  const user   = await findById(userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const code = generateCode();

  // Store in OtpCode table keyed by "phone:<number>"
  try {
    await pgPool.query(
      `INSERT INTO "OtpCode" (email, code, name, expires)
       VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes')
       ON CONFLICT (email) DO UPDATE SET code=$2, name=$3, expires=NOW() + INTERVAL '10 minutes'`,
      [`phone:${phone}`, code, user.name],
    );
  } catch (err) {
    console.error('[otp/send-phone] DB error', err);
    return NextResponse.json({ error: 'Failed to send code. Please try again.' }, { status: 500 });
  }

  const sent = await sendGhlSmsToPhone(
    { email: user.email, name: user.name, phone },
    `Your GasCap verification code: ${code}\n\nExpires in 10 minutes. Reply STOP to opt out.`,
  );

  if (!sent) {
    return NextResponse.json({ error: 'Failed to send SMS. Please check your number and try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
