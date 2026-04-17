import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import type { Session }     from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { findById, createEmailVerifyToken } from '@/lib/users';
import { sendMail, verificationEmailHtml }  from '@/lib/email';

function getBaseUrl(req: Request): string {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL.replace(/\/$/, '');
  const host  = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  if (host) return `${proto}://${host}`;
  return 'https://www.gascap.app';
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session as Session).user.id ?? session.user.email ?? '';
  const user   = await findById(userId);
  if (!user)  return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  if (user.emailVerified) return NextResponse.json({ error: 'Already verified.' }, { status: 400 });

  const token     = await createEmailVerifyToken(user.id);
  const baseUrl   = getBaseUrl(req);
  const verifyUrl = `${baseUrl}/verify-email?token=${token}`;

  await sendMail({
    to:      user.email,
    subject: 'Verify your GasCap™ email address',
    html:    verificationEmailHtml(user.name, verifyUrl),
    text:    `Hi ${user.name}, verify your GasCap account: ${verifyUrl}`,
  });

  return NextResponse.json({ ok: true });
}
