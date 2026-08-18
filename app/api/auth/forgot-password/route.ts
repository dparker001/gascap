import { NextResponse }        from 'next/server';
import { createPasswordResetToken } from '@/lib/users';
import { sendMail, passwordResetEmailHtml } from '@/lib/email';
import { checkRateLimitDb } from '@/lib/rateLimitDb';

// Sprint 2 — this endpoint had NO rate limiting at all before, found during
// the sprint's inspection pass. Layered per the brief: per-email (a specific
// account can't be flooded with reset emails) AND per-IP (one caller can't
// enumerate many addresses by trying each once). Postgres-backed so the
// limit survives a deploy and holds across instances — see lib/rateLimitDb.ts.
const RESET_MAX_PER_EMAIL = 3;
const RESET_MAX_PER_IP    = 10;
const RESET_WINDOW_MS     = 60 * 60 * 1000; // 1 hour — matches the token's own expiry

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

  // Rate limit BEFORE doing anything else — including before the "no
  // account" branch — so the response shape and timing stay identical
  // whether the request was rate-limited, the account doesn't exist, or the
  // email genuinely sent. Silently returning ok:true (rather than a 429) is
  // deliberate: a different status code on rate-limit would itself leak
  // "this address is being hammered," which is its own enumeration signal.
  const normalizedEmail = email.trim().toLowerCase();
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = (forwarded ?? req.headers.get('x-real-ip') ?? 'unknown').split(',')[0].trim();

  const [emailLimit, ipLimit] = await Promise.all([
    checkRateLimitDb(`pwreset-email:${normalizedEmail}`, RESET_MAX_PER_EMAIL, RESET_WINDOW_MS),
    checkRateLimitDb(`pwreset-ip:${ip}`, RESET_MAX_PER_IP, RESET_WINDOW_MS),
  ]);
  if (!emailLimit.allowed || !ipLimit.allowed) {
    return NextResponse.json({ ok: true });
  }

  const result = await createPasswordResetToken(email.trim());
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
