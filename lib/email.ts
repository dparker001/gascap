/**
 * Email utility — uses SMTP via Nodemailer if configured,
 * otherwise logs to console (dev/preview mode).
 *
 * Required env vars for real sending:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */

interface MailOptions {
  to:      string;
  subject: string;
  html:    string;
  text?:   string;
}

export async function sendMail(opts: MailOptions): Promise<void> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    // Dev fallback — log to console
    console.log('\n──────────────────────────────────────');
    console.log('[GasCap Email] DEV MODE — would send:');
    console.log(`  To:      ${opts.to}`);
    console.log(`  Subject: ${opts.subject}`);
    console.log(`  Text:    ${opts.text ?? '(html only)'}`);
    console.log('──────────────────────────────────────\n');
    return;
  }

  try {
    // Dynamic import so the module is only loaded server-side when needed
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport({
      host:   SMTP_HOST,
      port:   parseInt(SMTP_PORT ?? '587', 10),
      secure: parseInt(SMTP_PORT ?? '587', 10) === 465,
      auth:   { user: SMTP_USER, pass: SMTP_PASS },
    });

    await transporter.sendMail({
      from:    SMTP_FROM ?? `"GasCap™" <${SMTP_USER}>`,
      to:      opts.to,
      subject: opts.subject,
      html:    opts.html,
      text:    opts.text,
    });
  } catch (importErr) {
    // nodemailer not installed or SMTP error — log and re-throw
    console.error('[GasCap Email] Could not send email:', importErr);
    throw importErr;
  }
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
