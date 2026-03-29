/**
 * Email utility — tries Resend first, falls back to SMTP (Gmail),
 * otherwise logs to console (dev mode).
 *
 * Resend env vars: RESEND_API_KEY, RESEND_FROM
 * SMTP env vars:   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */

interface MailOptions {
  to:      string;
  subject: string;
  html:    string;
  text?:   string;
}

export async function sendMail(opts: MailOptions): Promise<void> {
  const resendKey  = process.env.RESEND_API_KEY;
  const smtpHost   = process.env.SMTP_HOST;
  const smtpUser   = process.env.SMTP_USER;
  const smtpPass   = process.env.SMTP_PASS;

  // ── Option 1: SMTP (Gmail) ─────────────────────────────────────────────
  if (smtpHost && smtpUser && smtpPass) {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport({
      host:   smtpHost,
      port:   parseInt(process.env.SMTP_PORT ?? '587', 10),
      secure: parseInt(process.env.SMTP_PORT ?? '587', 10) === 465,
      auth:   { user: smtpUser, pass: smtpPass },
    });
    await transporter.sendMail({
      from:    process.env.SMTP_FROM ?? `"GasCap™" <${smtpUser}>`,
      to:      opts.to,
      subject: opts.subject,
      html:    opts.html,
      text:    opts.text,
    });
    return;
  }

  // ── Option 2: Resend API ───────────────────────────────────────────────
  if (resendKey) {
    const from = process.env.RESEND_FROM ?? 'GasCap™ <onboarding@resend.dev>';
    const res  = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from,
        to:      [opts.to],
        subject: opts.subject,
        html:    opts.html,
        text:    opts.text,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('[GasCap Email] Resend error:', err);
      throw new Error(`Email send failed: ${err}`);
    }
    return;
  }

  // ── Option 3: Dev fallback ─────────────────────────────────────────────
  console.log('\n──────────────────────────────────────');
  console.log('[GasCap Email] DEV MODE — would send:');
  console.log(`  To:      ${opts.to}`);
  console.log(`  Subject: ${opts.subject}`);
  console.log(`  Text:    ${opts.text ?? '(html only)'}`);
  console.log('──────────────────────────────────────\n');
}

export function verificationEmailHtml(name: string, verifyUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f7;font-family:system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f7;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">
        <!-- Header -->
        <tr><td style="background:#1e2d4a;padding:24px 32px;">
          <span style="color:#fff;font-size:20px;font-weight:900;">GasCap<sup style="color:#f59e0b;font-size:11px;">™</sup></span>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;font-size:22px;font-weight:900;color:#1e2d4a;">Verify your email</p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;">Hi ${name}, confirm your email address to activate your GasCap account.</p>
          <a href="${verifyUrl}" style="display:inline-block;background:#f59e0b;color:#fff;font-weight:900;font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none;">
            ✓ Verify Email Address
          </a>
          <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;">This link expires in 24 hours. If you didn't create a GasCap account, you can ignore this email.</p>
          <p style="margin:12px 0 0;font-size:11px;color:#cbd5e1;word-break:break-all;">Or copy this link: ${verifyUrl}</p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#94a3b8;">GasCap™ · Know before you go · <a href="https://gascap.app" style="color:#f59e0b;">gascap.app</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}
