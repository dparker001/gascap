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

/**
 * Shared GasCap™ email header — navy bar with the white logo lockup image
 * (orange gas-pump icon + white "GasCap™" wordmark), matching the in-app
 * Header.tsx exactly.
 *
 * Image: /public/logo-lockup-white.png served from gascap.app CDN.
 * Fallback alt text shown when images are blocked.
 * Single source of truth for all transactional and campaign emails.
 */
export function brandHeader(): string {
  return `
        <tr><td style="background:#1e2d4a;padding:20px 32px;border-radius:16px 16px 0 0;">
          <img src="https://www.gascap.app/logo-lockup-white.png"
               alt="GasCap™"
               width="152" height="41"
               style="display:block;height:41px;width:auto;max-width:100%;border:0;outline:none;"
          />
        </td></tr>`;
}

export function passwordResetEmailHtml(name: string, resetUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f7;font-family:system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f7;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">
${brandHeader()}
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;font-size:22px;font-weight:900;color:#1e2d4a;">Reset your password</p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;">Hi ${name}, click the button below to set a new password for your GasCap™ account.</p>
          <a href="${resetUrl}" style="display:inline-block;background:#f59e0b;color:#fff;font-weight:900;font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none;">
            🔑 Reset Password
          </a>
          <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;">This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email — your password won't change.</p>
          <p style="margin:12px 0 0;font-size:11px;color:#cbd5e1;word-break:break-all;">Or copy this link: ${resetUrl}</p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#94a3b8;">GasCap™ · Know before you go · <a href="https://gascap.app" style="color:#f59e0b;">gascap.app</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

/** ─────────────────────────────────────────────────────────────────────────
 * Sweepstakes winner notification — sent immediately after a draw is run.
 * @param name         Winner's full name
 * @param month        "YYYY-MM" draw month
 * @param entryCount   Winner's entry count that month
 * @param totalEntries Total pool entries
 * @param prize        Prize description, e.g. "$25"
 */
export function winnerNotificationEmailHtml(
  name: string,
  month: string,
  entryCount: number,
  totalEntries: number,
  prize: string = '$25',
): string {
  const [y, mo] = month.split('-');
  const MONTH_NAMES = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];
  const monthLabel = `${MONTH_NAMES[parseInt(mo, 10) - 1]} ${y}`;
  const odds = totalEntries > 0
    ? `${((entryCount / totalEntries) * 100).toFixed(1)}%`
    : '—';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f7;font-family:system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f7;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">
${brandHeader()}
        <tr><td style="padding:32px;">

          <!-- Trophy -->
          <p style="margin:0 0 8px;font-size:52px;text-align:center;line-height:1;">🏆</p>
          <p style="margin:0 0 6px;font-size:23px;font-weight:900;color:#1e2d4a;text-align:center;">
            You won the ${monthLabel}<br>Gas Card Giveaway!
          </p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;text-align:center;">
            Congratulations, ${name}! Your entry was drawn from the pool this month. 🎉
          </p>

          <!-- Prize badge -->
          <table width="100%" cellpadding="0" cellspacing="0"
                 style="background:#fef3c7;border:2px solid #f59e0b;border-radius:14px;margin:0 0 24px;">
            <tr><td style="padding:20px 24px;text-align:center;">
              <p style="margin:0 0 4px;font-size:11px;font-weight:800;color:#b45309;
                         text-transform:uppercase;letter-spacing:.08em;">Your Prize</p>
              <p style="margin:0;font-size:36px;font-weight:900;color:#1e2d4a;">${prize} Gas Card</p>
              <p style="margin:6px 0 0;font-size:12px;color:#92400e;">
                ${entryCount}&nbsp;${entryCount === 1 ? 'entry' : 'entries'}&nbsp;·&nbsp;${odds}&nbsp;odds&nbsp;·&nbsp;${monthLabel}
              </p>
            </td></tr>
          </table>

          <!-- Body copy -->
          <p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.65;">
            A GasCap™ team member will reach out within&nbsp;<strong>7&nbsp;days</strong> with your
            prepaid gas card or a link to claim it digitally. Please reply to this email to confirm
            you received it — if we don't hear back within&nbsp;<strong>14&nbsp;days</strong> we
            may need to select an alternate winner per our official rules.
          </p>
          <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.65;">
            Questions? Email us any time at
            <a href="mailto:support@gascap.app"
               style="color:#15a680;font-weight:600;">support@gascap.app</a>.
          </p>

          <!-- CTA -->
          <div style="text-align:center;">
            <a href="https://gascap.app"
               style="display:inline-block;background:#005f4a;color:#fff;font-weight:900;
                      font-size:14px;padding:13px 28px;border-radius:12px;text-decoration:none;">
              Open GasCap™
            </a>
          </div>

        </td></tr>
        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#94a3b8;">
            GasCap™ · Know before you go ·
            <a href="https://gascap.app" style="color:#f59e0b;">gascap.app</a> ·
            <a href="https://gascap.app/sweepstakes-rules"
               style="color:#94a3b8;">Official Rules</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

export function verificationEmailHtml(
  name: string,
  verifyUrl: string,
  locale: 'en' | 'es' = 'en',
): string {
  const es = locale === 'es';
  const heading  = es ? 'Verifica tu correo'               : 'Verify your email';
  const body     = es
    ? `Hola ${name}, confirma tu dirección de correo para activar tu cuenta de GasCap™.`
    : `Hi ${name}, confirm your email address to activate your GasCap™ account.`;
  const btnLabel = es ? '✓ Verificar correo electrónico'   : '✓ Verify Email Address';
  const expiry   = es
    ? 'Este enlace expira en 24 horas. Si no creaste una cuenta de GasCap™, ignora este mensaje.'
    : 'This link expires in 24 hours. If you didn\'t create a GasCap™ account, you can ignore this email.';
  const copyLink = es ? 'O copia este enlace:'             : 'Or copy this link:';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f7;font-family:system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f7;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">
${brandHeader()}
        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;font-size:22px;font-weight:900;color:#1e2d4a;">${heading}</p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;">${body}</p>
          <a href="${verifyUrl}" style="display:inline-block;background:#f59e0b;color:#fff;font-weight:900;font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none;">
            ${btnLabel}
          </a>
          <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;">${expiry}</p>
          <p style="margin:12px 0 0;font-size:11px;color:#cbd5e1;word-break:break-all;">${copyLink} ${verifyUrl}</p>
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
