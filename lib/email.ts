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
  /**
   * Resend tags for dashboard filtering and open/click segmentation.
   * Each tag: { name: string; value: string }
   * Example: [{ name: 'campaign', value: 'trial-c1' }]
   */
  tags?: { name: string; value: string }[];
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
        ...(opts.tags?.length ? { tags: opts.tags } : {}),
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
              <p style="margin:6px 0 0;font-size:12px;color:#92400e;">${monthLabel}</p>
            </td></tr>
          </table>

          <!-- Body copy -->
          <p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.65;">
            Your&nbsp;<strong>${prize} Visa prepaid card</strong> is on its way — check this inbox
            for a separate email from our rewards partner with your digital claim link. It may take
            up to&nbsp;<strong>24&nbsp;hours</strong> to arrive. Check your spam folder if you
            don&apos;t see it.
          </p>
          <p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.65;">
            Please reply to this email to confirm you received your card. If we don&apos;t hear
            back within&nbsp;<strong>14&nbsp;days</strong> we may need to select an alternate
            winner per our
            <a href="https://gascap.app/sweepstakes-rules"
               style="color:#15a680;font-weight:600;">official rules</a>.
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
  const monthLabel  = `${MONTH_NAMES[parseInt(mo, 10) - 1]} ${y}`;
  const mMoN        = parseInt(mo, 10);
  const mYearN      = parseInt(y, 10);
  const eMo         = mMoN === 12 ? 1 : mMoN + 1;
  const eYear       = mMoN === 12 ? mYearN + 1 : mYearN;
  const nextEntryMonth = `${MONTH_NAMES[eMo - 1]} ${eYear}`;

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
                ${prize} Visa prepaid card
              </p>
            </td></tr>
          </table>

          <!-- How to earn more -->
          <p style="margin:0 0 12px;font-size:14px;font-weight:900;color:#1e2d4a;">
            Stack more entries in ${nextEntryMonth} →
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            ${[
              ['📅', '<strong>Open GasCap™ or log a fill-up every day</strong> — each active day earns 1 entry (up to 31/month)'],
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

/** ─────────────────────────────────────────────────────────────────────────
 * Streak milestone celebration email — sent the first time a user crosses
 * a streak milestone (7, 14, 30, 90, 180, 365 days).
 *
 * @param name               User's display name
 * @param milestoneDays      The milestone just hit (e.g. 7, 30, 90)
 * @param bonusEntries       Bonus draw entries now earned at this streak tier
 * @param nextMilestoneDays  Next milestone to aim for, or null if at max
 * @param nextBonusEntries   Bonus entries at the next milestone, or null
 * @param plan               'trial' | 'pro' | 'fleet' | 'comp' — for header badge
 */
export function streakMilestoneEmailHtml(
  name:               string,
  milestoneDays:      number,
  bonusEntries:       number,
  nextMilestoneDays:  number | null,
  nextBonusEntries:   number | null,
  plan?:              string,
): string {
  // Choose emoji + headline based on milestone
  const milestoneConfig: Record<number, { emoji: string; headline: string; subline: string }> = {
    7:   { emoji: '🔥', headline: `${name}, you're on a 7-day streak!`,    subline: 'One week in — you\'re already building a great habit.' },
    14:  { emoji: '⚡', headline: `${name}, 14 days straight!`,             subline: 'Two full weeks of smart fueling. Keep the momentum going.' },
    30:  { emoji: '🏆', headline: `${name}, one full month!`,               subline: 'A 30-day streak is a serious commitment — and GasCap™ rewards it.' },
    90:  { emoji: '🌟', headline: `${name}, 90 days on a streak!`,          subline: 'Three months of consistent fueling smarts. You\'re in rare company.' },
    180: { emoji: '💎', headline: `${name}, 6 months straight!`,            subline: 'Half a year of daily streaks. That\'s seriously impressive.' },
    365: { emoji: '👑', headline: `${name}, one full year on a streak!`,    subline: 'You\'ve done something almost no one does. This one\'s on us.' },
  };
  const cfg = milestoneConfig[milestoneDays] ?? {
    emoji:    '🔥',
    headline: `${name}, you hit a ${milestoneDays}-day streak!`,
    subline:  'Keep the streak alive — it keeps paying off.',
  };

  // Bonus entries block
  const bonusBlock = bonusEntries > 0 ? `
        <tr><td style="padding:0 32px 24px;">
          <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%">
            <tr>
              <td style="background:linear-gradient(135deg,#005f4a 0%,#1eb68f 100%);border-radius:14px;padding:20px 24px;">
                <p style="margin:0 0 4px;font-size:12px;font-weight:800;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:0.08em;">Your reward</p>
                <p style="margin:0 0 2px;font-size:28px;font-weight:900;color:#ffffff;line-height:1.1;">+${bonusEntries} bonus entries</p>
                <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.85);">added to your monthly gas card drawing — every single month you maintain this streak.</p>
              </td>
            </tr>
          </table>
        </td></tr>` : '';

  // "Next milestone" teaser
  const nextBlock = nextMilestoneDays ? `
        <tr><td style="padding:0 32px 24px;">
          <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%">
            <tr>
              <td style="background:#fff8ed;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;">
                <p style="margin:0 0 4px;font-size:12px;font-weight:800;color:#92400e;text-transform:uppercase;letter-spacing:0.08em;">Next milestone</p>
                <p style="margin:0;font-size:14px;color:#78350f;line-height:1.5;">
                  Hit <strong>${nextMilestoneDays} days</strong> and earn
                  ${nextBonusEntries ? `<strong>+${nextBonusEntries} bonus entries</strong>` : 'another reward'}.
                  You're ${milestoneDays} of the way there — keep going!
                </p>
              </td>
            </tr>
          </table>
        </td></tr>` : `
        <tr><td style="padding:0 32px 24px;">
          <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%">
            <tr>
              <td style="background:#fef3c7;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;">
                <p style="margin:0;font-size:14px;color:#78350f;line-height:1.5;">
                  <strong>You've reached the top tier — +20 bonus entries every month.</strong> There's no higher streak level. You've earned maximum rewards for life. 🏆
                </p>
              </td>
            </tr>
          </table>
        </td></tr>`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f7;font-family:system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f7;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">
${brandHeader(plan)}
        <!-- Hero -->
        <tr><td style="padding:32px 32px 20px;text-align:center;">
          <p style="margin:0 0 8px;font-size:48px;line-height:1;">${cfg.emoji}</p>
          <p style="margin:0 0 8px;font-size:22px;font-weight:900;color:#1e2d4a;line-height:1.3;">${cfg.headline}</p>
          <p style="margin:0;font-size:15px;color:#475569;line-height:1.65;">${cfg.subline}</p>
        </td></tr>
${bonusBlock}
${nextBlock}
        <!-- CTA -->
        <tr><td style="padding:0 32px 28px;text-align:center;">
          <a href="https://www.gascap.app" style="display:inline-block;background:#fa7109;color:#fff;font-weight:900;font-size:15px;padding:14px 36px;border-radius:12px;text-decoration:none;">
            Open GasCap™ →
          </a>
          <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">
            Your streak resets if you miss a day — open the app daily to protect it.<br>
            <a href="https://www.gascap.app/giveaway" style="color:#fa7109;font-weight:700;text-decoration:none;">View your drawing entries →</a>
          </p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#94a3b8;">
            GasCap™ · Know Before You Go · <a href="https://gascap.app" style="color:#f59e0b;">gascap.app</a><br>
            <a href="https://www.gascap.app/settings?optout=email" style="color:#cbd5e1;text-decoration:none;">Unsubscribe from streak notifications</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

/**
 * Gas Price Drop Alert email — sent by the price-alerts cron when the national
 * average falls below a user's saved threshold.
 *
 * @param name          User's first name (or display name)
 * @param currentPrice  Today's national average ($/gal)
 * @param threshold     User's saved alert price ($/gal)
 * @param plan          User's plan for the badge header ('pro' | 'fleet' | 'trial')
 */
export function priceAlertEmailHtml(
  name:         string,
  currentPrice: number,
  threshold:    number,
  plan:         string = 'pro',
): string {
  const savings = (threshold - currentPrice).toFixed(2);
  const current = currentPrice.toFixed(3);
  const thresh  = threshold.toFixed(2);

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f7;font-family:system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f7;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">
${brandHeader(plan)}

        <!-- Hero -->
        <tr><td style="padding:32px 32px 20px;text-align:center;">
          <p style="margin:0 0 8px;font-size:48px;line-height:1;">⛽</p>
          <p style="margin:0 0 8px;font-size:22px;font-weight:900;color:#1e2d4a;line-height:1.3;">
            Gas prices just dropped<br>below your alert!
          </p>
          <p style="margin:0;font-size:15px;color:#475569;line-height:1.65;">
            Hi ${name}, the US national average is now <strong>$${current}/gal</strong> —
            that's below your $${thresh} alert price.
          </p>
        </td></tr>

        <!-- Price badge -->
        <tr><td style="padding:0 32px 20px;">
          <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%">
            <tr>
              <td style="background:linear-gradient(135deg,#005f4a 0%,#1eb68f 100%);border-radius:14px;padding:20px 24px;text-align:center;">
                <p style="margin:0 0 4px;font-size:12px;font-weight:800;color:rgba(255,255,255,0.7);
                           text-transform:uppercase;letter-spacing:0.08em;">Current price</p>
                <p style="margin:0 0 6px;font-size:36px;font-weight:900;color:#ffffff;line-height:1.1;">
                  $${current}<span style="font-size:18px;font-weight:700;color:rgba(255,255,255,0.7);"> /gal</span>
                </p>
                <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.85);">
                  ${savings}¢ below your $${thresh} alert threshold — now is a good time to fill up.
                </p>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Tip -->
        <tr><td style="padding:0 32px 24px;">
          <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%">
            <tr>
              <td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;">
                <p style="margin:0;font-size:13px;color:#166534;line-height:1.6;">
                  💡 <strong>Pro tip:</strong> Prices are based on the latest US national average from the
                  EIA. Local prices at the pump may vary — check your nearest station before heading out.
                </p>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- CTA -->
        <tr><td style="padding:0 32px 28px;text-align:center;">
          <a href="https://www.gascap.app"
             style="display:inline-block;background:#fa7109;color:#fff;font-weight:900;
                    font-size:15px;padding:14px 36px;border-radius:12px;text-decoration:none;">
            Calculate my fill-up →
          </a>
          <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">
            To update or remove your price alert, visit
            <a href="https://www.gascap.app/settings?tab=alerts"
               style="color:#fa7109;font-weight:700;text-decoration:none;">Settings → Price Alert</a>.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#94a3b8;">
            GasCap™ · Know Before You Go ·
            <a href="https://gascap.app" style="color:#f59e0b;">gascap.app</a><br>
            Price data sourced from the US Energy Information Administration (EIA).<br>
            <a href="https://www.gascap.app/settings?tab=alerts"
               style="color:#cbd5e1;text-decoration:none;">Manage price alerts</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

/** ─────────────────────────────────────────────────────────────────────────
 * Founding Member blast — one-time offer email sent to active trial users.
 * @param firstName      Recipient's first name
 * @param trialEndDate   Formatted end date, e.g. "May 26"
 * @param daysLeft       Integer days remaining (≥ 1)
 */
/** ─────────────────────────────────────────────────────────────────────────
 * Gift email — sent when someone buys GasCap™ Pro Lifetime as a gift.
 * Goes to the recipient (if delivered directly) or the buyer (to hand over).
 *
 * @param opts.code           Redemption code, e.g. GASCAP-7K2P-9QX4
 * @param opts.redeemUrl      Full claim link, e.g. https://www.gascap.app/redeem?code=...
 * @param opts.occasion       gift | fathers-day | birthday | holiday — drives theming
 * @param opts.toRecipient    true = email is addressed to the recipient; false = to the buyer
 * @param opts.recipientName  Recipient's name (optional)
 * @param opts.purchaserName  Buyer's name/email (optional, shown to recipient as "from")
 * @param opts.giftMessage    Optional personal note from the buyer
 */
export function giftEmailHtml(opts: {
  code:          string;
  redeemUrl:     string;
  occasion?:     string;
  toRecipient:   boolean;
  recipientName?: string | null;
  purchaserName?: string | null;
  giftMessage?:  string | null;
}): string {
  const { code, redeemUrl, occasion = 'gift', toRecipient } = opts;
  const recipientName = opts.recipientName?.trim();
  const purchaserName = opts.purchaserName?.trim();
  const giftMessage   = opts.giftMessage?.trim();

  const themes: Record<string, { emoji: string; label: string }> = {
    'fathers-day': { emoji: '👔', label: "a Father's Day gift" },
    'birthday':    { emoji: '🎂', label: 'a birthday gift' },
    'holiday':     { emoji: '🎁', label: 'a holiday gift' },
    'gift':        { emoji: '🎁', label: 'a gift' },
  };
  const theme = themes[occasion] ?? themes.gift;

  const heading = toRecipient
    ? `${theme.emoji} You've been gifted GasCap™ Pro Lifetime!`
    : `${theme.emoji} Your GasCap™ Pro Lifetime gift is ready`;

  const intro = toRecipient
    ? `${recipientName ? `Hi ${recipientName}, ` : ''}${purchaserName ? `<strong>${purchaserName}</strong> sent you` : 'You\'ve been sent'} ${theme.label}: <strong>GasCap™ Pro Lifetime</strong> — every Pro feature, forever, with no subscription. 🎉`
    : `Thank you! Your gift of <strong>GasCap™ Pro Lifetime</strong> is ready to give. Forward this email or share the code below with ${recipientName ? recipientName : 'the lucky recipient'} so they can claim it.`;

  const messageBlock = giftMessage ? `
        <tr><td style="padding:0 32px 20px;">
          <div style="background:#f8fafc;border-left:4px solid #1eb68f;border-radius:8px;padding:14px 18px;">
            <p style="margin:0 0 4px;font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.06em;">Personal note</p>
            <p style="margin:0;font-size:14px;color:#334155;line-height:1.6;font-style:italic;">"${giftMessage}"</p>
          </div>
        </td></tr>` : '';

  const ctaLabel = toRecipient ? '🎁 Claim My Pro Lifetime' : 'View the gift &amp; claim link';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f7;font-family:system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f7;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">
${brandHeader()}
        <tr><td style="padding:32px 32px 16px;">
          <p style="margin:0 0 8px;font-size:22px;font-weight:900;color:#1e2d4a;line-height:1.3;">${heading}</p>
          <p style="margin:0 0 8px;font-size:15px;color:#475569;line-height:1.65;">${intro}</p>
        </td></tr>
${messageBlock}
        <!-- Code block -->
        <tr><td style="padding:0 32px 8px;">
          <div style="background:linear-gradient(135deg,#005f4a 0%,#1eb68f 100%);border-radius:14px;padding:22px 24px;text-align:center;">
            <p style="margin:0 0 6px;font-size:12px;font-weight:800;color:rgba(255,255,255,.75);text-transform:uppercase;letter-spacing:.08em;">Your gift code</p>
            <p style="margin:0;font-size:26px;font-weight:900;color:#ffffff;letter-spacing:2px;font-family:'Courier New',monospace;">${code}</p>
          </div>
        </td></tr>
        <!-- CTA -->
        <tr><td style="padding:20px 32px 8px;text-align:center;">
          <a href="${redeemUrl}" style="display:inline-block;background:#fa7109;color:#fff;font-weight:900;font-size:15px;padding:14px 36px;border-radius:12px;text-decoration:none;">
            ${ctaLabel}
          </a>
          <p style="margin:14px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">
            ${toRecipient
              ? 'Sign in or create a free GasCap™ account, then your Lifetime access activates instantly.'
              : 'The recipient signs in or creates a free account, enters the code, and Lifetime activates instantly.'}
          </p>
          <p style="margin:8px 0 0;font-size:11px;color:#cbd5e1;word-break:break-all;">Or copy this link: ${redeemUrl}</p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;margin-top:16px;">
          <p style="margin:0;font-size:11px;color:#94a3b8;">GasCap™ · Know before you go · <a href="https://gascap.app" style="color:#f59e0b;">gascap.app</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

export function foundingMemberBlastHtml(
  firstName:    string,
  trialEndDate: string,
  daysLeft:     number,
): string {
  const urgencyLabel = daysLeft === 1
    ? '⏰ Your trial ends <strong>tomorrow</strong>'
    : `Your trial ends <strong>${trialEndDate}</strong> — ${daysLeft} days left`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f7;font-family:system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f7;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">
${brandHeader('trial')}
        <tr><td style="padding:32px;">

          <!-- Urgency ribbon -->
          <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;
                      padding:10px 16px;margin-bottom:24px;text-align:center;">
            <p style="margin:0;font-size:13px;color:#c2410c;">${urgencyLabel}</p>
          </div>

          <p style="margin:0 0 6px;font-size:22px;font-weight:900;color:#1e2d4a;">
            You're one of our first 200 members, ${firstName}.
          </p>
          <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;">
            That means something. As a thank-you for being here from the start,
            we're giving Founding Members a permanent perk that future subscribers
            won't have access to.
          </p>

          <!-- Perk card -->
          <div style="background:#f0fdf9;border:1.5px solid #1eb68f;border-radius:14px;
                      padding:20px 24px;margin-bottom:24px;">
            <p style="margin:0 0 6px;font-size:13px;font-weight:800;color:#1eb68f;
                       text-transform:uppercase;letter-spacing:0.05em;">
              ⭐ Founding Member Perk
            </p>
            <p style="margin:0 0 4px;font-size:18px;font-weight:900;color:#1e2d4a;">
              2× Giveaway Entries — Every Month, Forever
            </p>
            <p style="margin:0;font-size:14px;color:#475569;line-height:1.5;">
              Convert to Pro before your trial ends and earn double entries in
              every monthly $25 gas card giveaway — permanently. Regular Pro
              members get 1× entries. Founding Members get 2×.
            </p>
          </div>

          <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.6;">
            This offer is only available to the first 200 trial members and
            expires when your trial ends on <strong>${trialEndDate}</strong>.
            After that, it's gone.
          </p>

          <!-- CTA -->
          <div style="text-align:center;margin-bottom:24px;">
            <a href="https://www.gascap.app/settings"
               style="display:inline-block;background:#fa7109;color:#fff;font-weight:900;
                      font-size:16px;padding:16px 40px;border-radius:12px;
                      text-decoration:none;letter-spacing:-0.2px;">
              Claim My Founding Member Status →
            </a>
          </div>

          <!-- What's included -->
          <div style="background:#f8fafc;border-radius:12px;padding:16px 20px;margin-bottom:20px;">
            <p style="margin:0 0 10px;font-size:12px;font-weight:800;color:#1e2d4a;
                       text-transform:uppercase;letter-spacing:0.05em;">What's included with Pro</p>
            <table cellpadding="0" cellspacing="0" width="100%">
              ${[
                'Unlimited fill-up tracking &amp; history',
                'Live local gas prices',
                'MPG trends &amp; fuel insights',
                '2× monthly giveaway entries (Founding Member)',
                'AI fuel advisor',
              ].map(item => `
              <tr>
                <td style="padding:3px 0;font-size:13px;color:#475569;">
                  <span style="color:#1eb68f;font-weight:900;margin-right:8px;">✓</span>${item}
                </td>
              </tr>`).join('')}
            </table>
          </div>

          <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
            Questions? Reply to this email or reach us at
            <a href="mailto:admin@gascap.app" style="color:#fa7109;">admin@gascap.app</a>
          </p>
        </td></tr>

        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;">
            GasCap™ · Know Before You Go ·
            <a href="https://gascap.app" style="color:#f59e0b;">gascap.app</a><br>
            Gas Capacity LLC · 16260 Bristol Lake Circle, Orlando FL 32828<br>
            <a href="https://www.gascap.app/settings?optout=email"
               style="color:#cbd5e1;text-decoration:none;">Unsubscribe</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}
