import { NextResponse }        from 'next/server';
import { createPasswordResetToken } from '@/lib/users';
import { sendMail, passwordResetEmailHtml } from '@/lib/email';

function getBaseUrl(req: Request): string {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL.replace(/\/$/, '');
  const host  = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  if (host) return `${proto}://${host}`;
  return 'https://www.gascap.app';
}

export async function POST(req: Request) {
  const { email } = await req.json() as { email?: string };

  // Always return 200 — never reveal whether an email exists (prevents enumeration)
  if (!email?.trim()) return NextResponse.json({ ok: true });

  const result = createPasswordResetToken(email.trim());
  if (!result) return NextResponse.json({ ok: true }); // no account — silent

  const baseUrl   = getBaseUrl(req);
  const resetUrl  = `${baseUrl}/reset-password?token=${result.token}`;

  try {
    await sendMail({
      to:      result.user.email,
      subject: 'Reset your GasCap™ password',
      html:    passwordResetEmailHtml(result.user.name, resetUrl),
      text:    `Hi ${result.user.name}, reset your GasCap password: ${resetUrl} (expires in 1 hour)`,
    });
  } catch (err) {
    console.error('[GasCap] Failed to send password reset email:', err);
  }

  return NextResponse.json({ ok: true });
}
