/**
 * Email utility — tries Resend first, falls back to SMTP (Gmail),
 * otherwise logs to console (dev mode).
 *
 * Resend env vars: RESEND_API_KEY, RESEND_FROM
 * SMTP env vars:   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */

interface MailOptions {
  to:              string;
  subject:         string;
  html:            string;
  text?:           string;
  /** One-click unsubscribe URL — sets List-Unsubscribe headers for better inbox placement. */
  unsubscribeUrl?: string;
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
      ...(opts.unsubscribeUrl ? {
        headers: {
          'List-Unsubscribe':      `<${opts.unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      } : {}),
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
        ...(opts.unsubscribeUrl ? {
          headers: {
            'List-Unsubscribe':      `<${opts.unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        } : {}),
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
 * Shared GasCap™ email header — mirrors Header.tsx exactly:
 * transparent orange pump icon + white "GasCap™" text on the navy bar.
 *
 * Optional `plan` param adds a right-side badge + "Open App →" link:
 *   'trial'  → ⭐ Pro Trial  (amber tones)
 *   'pro'    → ⭐ Pro Member (green)
 *   'fleet'  → 🚗 Fleet Member (teal)
 *   'comp'   → 🎁 Ambassador Pro (dark green)
 *   undefined → no badge (transactional emails: verify, reset, winner)
 */
export function brandHeader(plan?: string): string {
  let badge = '';
  if (plan) {
    const configs: Record<string, { emoji: string; label: string; bg: string; border: string; color: string }> = {
      trial: { emoji: '⭐', label: 'Pro Trial',      bg: 'rgba(250,113,9,0.18)',   border: 'rgba(250,113,9,0.4)',    color: '#fbbf24' },
      pro:   { emoji: '⭐', label: 'Pro Member',     bg: 'rgba(30,182,143,0.18)',  border: 'rgba(30,182,143,0.4)',   color: '#6ee7d0' },
      fleet: { emoji: '🚗', label: 'Fleet Member',   bg: 'rgba(30,182,143,0.18)',  border: 'rgba(30,182,143,0.4)',   color: '#6ee7d0' },
      comp:  { emoji: '🎁', label: 'Ambassador Pro', bg: 'rgba(0,95,74,0.35)',     border: 'rgba(30,182,143,0.5)',   color: '#6ee7d0' },
    };
    const cfg = configs[plan] ?? configs.pro;
    const appUrl = plan === 'trial' ? 'https://www.gascap.app/upgrade' : 'https://www.gascap.app';
    const appLabel = plan === 'trial' ? 'Upgrade to Pro →' : 'Open App →';
    badge = `
              <td style="text-align:right;vertical-align:middle;white-space:nowrap;">
                <div style="display:inline-block;background:${cfg.bg};border:1px solid ${cfg.border};
                            border-radius:20px;padding:4px 12px;margin-bottom:5px;">
                  <span style="font-family:system-ui,-apple-system,sans-serif;font-size:11px;
                               font-weight:800;color:${cfg.color};white-space:nowrap;">
                    ${cfg.emoji} ${cfg.label}
                  </span>
                </div><br>
                <a href="${appUrl}"
                   style="font-family:system-ui,-apple-system,sans-serif;font-size:11px;
                          font-weight:700;color:#fa7109;text-decoration:none;">${appLabel}</a>
              </td>`;
  }

  return `
        <tr><td style="background:#1e2d4a;padding:20px 32px;border-radius:16px 16px 0 0;">
          <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%">
            <tr>
              <td style="vertical-align:middle;">
                <table cellpadding="0" cellspacing="0" border="0" role="presentation">
                  <tr>
                    <td style="vertical-align:middle;padding-right:8px;">
                      <img src="https://www.gascap.app/gascap-icon-raw.png"
                           alt="" width="44" height="44"
                           style="display:block;width:44px;height:44px;border:0;outline:none;" />
                    </td>
                    <td style="vertical-align:middle;">
                      <span style="font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;
                                   font-size:26px;font-weight:900;color:#ffffff;
                                   letter-spacing:-0.5px;line-height:1;white-space:nowrap;">
                        GasCap<sup style="font-size:12px;font-weight:900;color:#ffffff;
                                          vertical-align:super;line-height:0;">™</sup>
                      </span>
                    </td>
                  </tr>
                </table>
              </td>${badge}
            </tr>
          </table>
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
              <p style="margin:0;font-size:36px;font-weight:900;color:#1e2d4a;">${prize} Visa Prepaid Card</p>
              <p style="margin:6px 0 0;font-size:12px;color:#92400e;">
                ${entryCount}&nbsp;${entryCount === 1 ? 'entry' : 'entries'}&nbsp;·&nbsp;${odds}&nbsp;odds&nbsp;·&nbsp;${monthLabel}
              </p>
            </td></tr>
          </table>

          <!-- Body copy -->
          <p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.65;">
            A GasCap™ team member will reach out within&nbsp;<strong>7&nbsp;days</strong> with your
            Visa prepaid card — use it at the pump or anywhere Visa is accepted — or a link to claim it digitally. Please reply to this email to confirm
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

/**
 * Non-winner notification — sent to all eligible entrants who did not win.
 * Announces the winner (first name + last initial + city), shows the
 * recipient's personal entry count, and motivates them to earn more next month.
 *
 * @param recipientName   Recipient's first name
 * @param winnerLabel     Anonymized winner, e.g. "Madlon P. — Orlando, FL"
 * @param month           "YYYY-MM" draw month
 * @param entryCount      Recipient's entry count that month
 * @param totalEntries    Total pool entries
 * @param nextDrawMonth   Human-readable next draw month, e.g. "June 2026"
 * @param plan            Recipient's plan for the badge header
 * @param prize           Prize amount, e.g. "$25"
 */
export function nonWinnerNotificationEmailHtml(
  recipientName: string,
  winnerLabel:   string,
  month:         string,
  entryCount:    number,
  totalEntries:  number,
  nextDrawMonth: string,
  plan:          string = 'pro',
  prize:         string = '$25',
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
${brandHeader(plan)}
        <tr><td style="padding:32px;">

          <!-- Heading -->
          <p style="margin:0 0 6px;font-size:22px;font-weight:900;color:#1e2d4a;text-align:center;">
            ${monthLabel} Drawing Results
          </p>
          <p style="margin:0 0 24px;font-size:14px;color:#475569;text-align:center;">
            Hi ${recipientName} — the ${monthLabel} Gas Card Drawing just wrapped up.
          </p>

          <!-- Winner announcement -->
          <table width="100%" cellpadding="0" cellspacing="0"
                 style="background:#f0fdf4;border:2px solid #86efac;border-radius:14px;margin:0 0 24px;">
            <tr><td style="padding:18px 24px;text-align:center;">
              <p style="margin:0 0 4px;font-size:11px;font-weight:800;color:#15803d;
                         text-transform:uppercase;letter-spacing:.08em;">${monthLabel} Winner 🏆</p>
              <p style="margin:0;font-size:20px;font-weight:900;color:#1e2d4a;">${winnerLabel}</p>
              <p style="margin:6px 0 0;font-size:12px;color:#166534;">
                ${prize} Visa prepaid card · ${totalEntries} total entries in the pool
              </p>
            </td></tr>
          </table>

          <!-- Personal stats -->
          <table width="100%" cellpadding="0" cellspacing="0"
                 style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;margin:0 0 24px;">
            <tr><td style="padding:16px 20px;">
              <p style="margin:0 0 10px;font-size:12px;font-weight:800;color:#64748b;
                         text-transform:uppercase;letter-spacing:.06em;">Your ${monthLabel} Stats</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="text-align:center;padding:8px;">
                    <p style="margin:0;font-size:28px;font-weight:900;color:#1e2d4a;">${entryCount}</p>
                    <p style="margin:2px 0 0;font-size:11px;color:#94a3b8;">
                      ${entryCount === 1 ? 'entry' : 'entries'}
                    </p>
                  </td>
                  <td style="text-align:center;padding:8px;border-left:1px solid #e2e8f0;">
                    <p style="margin:0;font-size:28px;font-weight:900;color:#1e2d4a;">${odds}</p>
                    <p style="margin:2px 0 0;font-size:11px;color:#94a3b8;">your odds</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>

          <!-- How to earn more -->
          <p style="margin:0 0 12px;font-size:14px;font-weight:900;color:#1e2d4a;">
            Stack more entries for ${nextDrawMonth} →
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            ${[
              ['📅', '<strong>Open GasCap™ every day</strong> — each active day earns 1 entry (up to 31/month)'],
              ['⚡', '<strong>Build your streak</strong> — 7 days = +2 bonus · 30 days = +5 · 90 days = +10 · 180 days = +15 · 1 year = +20'],
              ['📈', '<strong>More entries = better odds</strong> — a full month of daily opens plus a streak can put you well ahead of the pool'],
            ].map(([emoji, text]) => `
            <tr>
              <td style="width:32px;vertical-align:top;padding:5px 8px 5px 0;
                         font-size:18px;line-height:1.4;">${emoji}</td>
              <td style="vertical-align:top;padding:5px 0;font-size:13px;
                         color:#475569;line-height:1.5;">${text}</td>
            </tr>`).join('')}
          </table>

          <!-- CTA -->
          <div style="text-align:center;margin-bottom:8px;">
            <a href="https://gascap.app"
               style="display:inline-block;background:#005f4a;color:#fff;font-weight:900;
                      font-size:14px;padding:13px 28px;border-radius:12px;text-decoration:none;">
              ⛽ Open GasCap™ Today
            </a>
          </div>
          <p style="margin:12px 0 0;font-size:12px;color:#94a3b8;text-align:center;">
            Next drawing: on or about the 5th of ${nextDrawMonth}
          </p>

        </td></tr>
        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#94a3b8;">
            GasCap™ · Know before you go ·
            <a href="https://gascap.app" style="color:#f59e0b;">gascap.app</a> ·
            <a href="https://gascap.app/sweepstakes-rules" style="color:#94a3b8;">Official Rules</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

/**
 * Account deletion confirmation email — sent automatically when an admin
 * deletes a user account (or when a user requests self-deletion in future).
 */
export function accountDeletedEmailHtml(name: string): string {
  const first = name.split(' ')[0];
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
          <p style="margin:0 0 8px;font-size:22px;font-weight:900;color:#1e2d4a;">Your account has been deleted</p>
          <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">
            Hi ${first}, this email confirms that your GasCap™ account has been permanently deleted as requested.
          </p>

          <!-- What was removed -->
          <table width="100%" cellpadding="0" cellspacing="0"
                 style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin:0 0 24px;">
            <tr><td style="padding:18px 20px;">
              <p style="margin:0 0 10px;font-size:12px;font-weight:800;color:#64748b;
                         text-transform:uppercase;letter-spacing:.06em;">What was removed</p>
              ${[
                'Your account and login credentials',
                'Saved vehicles and garage data',
                'Fill-up history and fuel logs',
                'Personal profile information on file',
              ].map(item => `
              <table cellpadding="0" cellspacing="0" style="margin-bottom:6px;">
                <tr>
                  <td style="width:20px;vertical-align:top;font-size:13px;color:#15a680;padding-top:1px;">✓</td>
                  <td style="font-size:13px;color:#475569;line-height:1.5;">${item}</td>
                </tr>
              </table>`).join('')}
            </td></tr>
          </table>

          <p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.65;">
            This action is permanent and cannot be undone. If you had an active Pro trial, it has been cancelled and no charges were or will be applied.
          </p>
          <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.65;">
            If you ever want to start fresh, you're always welcome to create a new account at
            <a href="https://www.gascap.app" style="color:#15a680;font-weight:600;">gascap.app</a> — no hard feelings.
          </p>
          <p style="margin:0 0 0;font-size:13px;color:#94a3b8;">
            If you didn't request this deletion or believe this was done in error, please reply to this email immediately.
          </p>
          <p style="margin:20px 0 16px;font-size:13px;color:#475569;line-height:1.65;">
            Before you go — mind sharing why you decided to delete your account? Just hit reply and let us know. We read every response and use your feedback to improve GasCap™.
          </p>
          <p style="margin:0;font-size:13px;color:#475569;">— The GasCap™ Team</p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#94a3b8;">
            GasCap™ · Know before you go ·
            <a href="https://gascap.app" style="color:#f59e0b;">gascap.app</a>
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
  isReminder: boolean = false,
): string {
  const es       = locale === 'es';
  const first    = name.split(' ')[0];

  const heading  = isReminder
    ? (es ? `${first}, todavía no has verificado tu correo` : `${first}, your email is still unverified`)
    : (es ? 'Verifica tu correo' : 'Verify your email');

  const body = isReminder
    ? (es
        ? `Te registraste en GasCap™ Pro pero tu dirección de correo aún no ha sido verificada. Solo toma 5 segundos — y mantiene tu cuenta segura.`
        : `You signed up for GasCap™ Pro, but your email address still hasn't been verified. It takes about 5 seconds — and it keeps your account secure so we can send billing confirmations and help you recover access if you're ever locked out.`)
    : (es
        ? `Hola ${first}, confirma tu dirección de correo para activar tu cuenta de GasCap™.`
        : `Hi ${first}, confirm your email address to activate your GasCap™ account.`);

  const btnLabel = es ? '✓ Verificar mi cuenta de GasCap™' : '✓ Verify My GasCap™ Account';

  const expiryDays = isReminder ? 7 : 1;
  const expiry = es
    ? `Este enlace expira en ${expiryDays === 7 ? '7 días' : '24 horas'}. Si no creaste una cuenta de GasCap™, ignora este mensaje.`
    : `This link expires in ${expiryDays === 7 ? '7 days' : '24 hours'}. If you didn't create a GasCap™ account, you can ignore this email.`;

  const copyLink = es ? 'O copia este enlace:' : 'Or copy this link:';

  const bonusBlock = isReminder ? `
        <!-- 25-entry bonus callout -->
        <tr><td style="padding:0 32px 24px;">
          <div style="background:#fef9f0;border:2px solid #f59e0b;border-radius:12px;padding:18px 20px;">
            <p style="margin:0 0 6px;font-size:14px;font-weight:900;color:#92400e;">
              🎁 Bonus: 25 free draw entries — just for verifying
            </p>
            <p style="margin:0;font-size:13px;color:#78350f;line-height:1.65;">
              Verify your email within <strong>7 days</strong> of receiving this message and we'll
              automatically credit <strong>25 bonus entries</strong> toward the monthly
              gas card drawing — no extra steps needed. The sooner you verify, the sooner
              your entries are in.
            </p>
          </div>
        </td></tr>` : '';

  const signature = `
        <p style="margin:24px 0 0;font-size:13px;color:#475569;">
          — The GasCap™ Team
        </p>`;

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
        <tr><td style="padding:32px 32px 20px;">
          <p style="margin:0 0 8px;font-size:22px;font-weight:900;color:#1e2d4a;">${heading}</p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.65;">${body}</p>
          <a href="${verifyUrl}" style="display:inline-block;background:#f59e0b;color:#fff;font-weight:900;font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none;">
            ${btnLabel}
          </a>
          <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;">${expiry}</p>
          <p style="margin:10px 0 0;font-size:11px;color:#cbd5e1;word-break:break-all;">${copyLink} ${verifyUrl}</p>
          ${signature}
        </td></tr>
${bonusBlock}
        <!-- Footer -->
        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#94a3b8;">GasCap™ · Know Before You Go · <a href="https://gascap.app" style="color:#f59e0b;">gascap.app</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}
