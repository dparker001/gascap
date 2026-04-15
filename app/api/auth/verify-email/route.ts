/**
 * GET /api/auth/verify-email?token=<TOKEN>
 * Verifies the token and redirects to / with a success flag.
 *
 * POST /api/auth/verify-email
 * Resends a verification email. Requires auth.
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { findById, verifyEmailToken, createEmailVerifyToken, creditVerifiedReferral } from '@/lib/users';
import { sendMail, verificationEmailHtml } from '@/lib/email';

function getBaseUrl(req: Request): string {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL.replace(/\/$/, '');
  const host  = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  if (host) return `${proto}://${host}`;
  return 'https://www.gascap.app';
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token   = searchParams.get('token') ?? '';
  const baseUrl = getBaseUrl(req);

  if (!token) {
    return NextResponse.redirect(`${baseUrl}/?verified=invalid`);
  }

  const result = verifyEmailToken(token);
  if (!result.ok) {
    const msg = encodeURIComponent(result.error ?? 'Verification failed.');
    return NextResponse.redirect(`${baseUrl}/?verified=error&msg=${msg}`);
  }

  if (result.userId) {
    creditVerifiedReferral(result.userId);
  }

  // Send the user straight to the app. The EmailVerificationBanner component
  // calls session.update() on mount, which re-fetches emailVerified from the
  // DB and refreshes the JWT so the banner disappears automatically.
  return NextResponse.redirect(`${baseUrl}/?verified=success`);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const user   = findById(userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  if (user.emailVerified) {
    return NextResponse.json({ message: 'Email already verified.' });
  }

  try {
    const token     = createEmailVerifyToken(userId);
    const baseUrl   = getBaseUrl(req);
    const verifyUrl = `${baseUrl}/verify-email?token=${token}`;
    await sendMail({
      to:      user.email,
      subject: 'Verify your GasCap™ email address',
      html:    verificationEmailHtml(user.name, verifyUrl),
      text:    `Hi ${user.name}, verify your GasCap account: ${verifyUrl}`,
    });
    return NextResponse.json({ message: 'Verification email sent.' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to send email.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
