/**
 * POST /api/auth/otp/send
 *
 * Generates a 6-digit OTP, stores it in memory (10 min TTL), and sends it to
 * the user's email. Rate-limited to 3 sends per email per 15 minutes.
 *
 * Body: { email: string; name?: string }
 * - name is captured at signup so the account can be created on first verify.
 * - On sign-in (returning user) name is omitted; we'll derive it from the DB.
 */

import { NextResponse } from 'next/server';
import { findByEmail }  from '@/lib/users';
import { checkOtpRate, createOtp } from '@/lib/otpStore';
import { sendMail }     from '@/lib/email';

export async function POST(req: Request) {
  let email: string;
  let name:  string;

  try {
    const body = await req.json() as { email?: string; name?: string };
    email = (body.email ?? '').toLowerCase().trim();
    name  = (body.name  ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  }

  // If no name provided (sign-in flow), try to pull it from the existing user.
  if (!name) {
    const existing = await findByEmail(email);
    name = existing?.name ?? '';
  }

  if (!checkOtpRate(email)) {
    return NextResponse.json(
      { error: 'Too many codes sent. Please wait 15 minutes before trying again.' },
      { status: 429 },
    );
  }

  const code = createOtp(email, name);

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#1e3a5f;padding:24px 32px;text-align:center;">
            <span style="color:#ffffff;font-size:22px;font-weight:900;letter-spacing:-0.5px;">GasCap™</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 8px;font-size:15px;color:#475569;">Your sign-in code${name ? ` for ${name}` : ''}:</p>
            <div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:12px;padding:24px;text-align:center;margin:16px 0;">
              <span style="font-size:42px;font-weight:900;letter-spacing:10px;color:#1e3a5f;font-family:'Courier New',monospace;">${code}</span>
            </div>
            <p style="margin:16px 0 0;font-size:13px;color:#64748b;line-height:1.5;">
              This code expires in <strong>10 minutes</strong>. If you didn't request it, you can safely ignore this email.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px 24px;border-top:1px solid #f1f5f9;">
            <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;">
              GasCap™ · Know before you go · <a href="https://gascap.app" style="color:#94a3b8;">gascap.app</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  try {
    await sendMail({
      to:      email,
      subject: `${code} — your GasCap sign-in code`,
      html,
      text:    `Your GasCap sign-in code: ${code}\n\nExpires in 10 minutes. If you didn't request this, ignore this email.`,
    });
  } catch (err) {
    console.error('[otp/send] email failed', err);
    return NextResponse.json({ error: 'Failed to send email. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
