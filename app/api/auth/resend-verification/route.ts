import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import type { Session }     from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { findById, createEmailVerifyToken } from '@/lib/users';
import { sendMail, verificationEmailHtml }  from '@/lib/email';

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session as Session).user.id ?? session.user.email ?? '';
  const user   = findById(userId);
  if (!user)  return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  if (user.emailVerified) return NextResponse.json({ error: 'Already verified.' }, { status: 400 });

  const token     = createEmailVerifyToken(user.id);
  const baseUrl   = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const verifyUrl = `${baseUrl}/verify-email?token=${token}`;

  await sendMail({
    to:      user.email,
    subject: 'Verify your GasCap™ email address',
    html:    verificationEmailHtml(user.name, verifyUrl),
    text:    `Hi ${user.name}, verify your GasCap account: ${verifyUrl}`,
  });

  return NextResponse.json({ ok: true });
}
