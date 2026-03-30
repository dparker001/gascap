/**
 * POST /api/admin/beta-expire
 * Called daily by a cron job. Reverts expired beta trials to free,
 * sends each user an upgrade prompt email, notifies admin.
 *
 * Auth: ADMIN_PASSWORD header OR CRON_SECRET header (for scheduler).
 */
import { NextResponse }           from 'next/server';
import { getExpiredBetaUsers, setUserPlan } from '@/lib/users';
import { updateGhlContactPlan, removeGhlTags } from '@/lib/ghl';
import { sendMail }               from '@/lib/email';

function auth(req: Request): boolean {
  const adminPw  = process.env.ADMIN_PASSWORD ?? '';
  const cronSecret = process.env.CRON_SECRET  ?? '';
  const header   = req.headers.get('x-admin-password') ?? req.headers.get('x-cron-secret') ?? '';
  return Boolean((adminPw && header === adminPw) || (cronSecret && header === cronSecret));
}

export async function POST(req: Request) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const expired = getExpiredBetaUsers();
  if (expired.length === 0) return NextResponse.json({ reverted: 0 });

  const results: string[] = [];

  for (const user of expired) {
    // 1. Revert to free
    setUserPlan(user.id, 'free');

    // 2. Sync GHL — revert plan tag + remove beta-tester tag
    updateGhlContactPlan(user.email, 'free')
      .catch((e) => console.error('[GHL] beta revert sync failed:', e));
    removeGhlTags(user.email, ['gascap-beta-tester'])
      .catch((e) => console.error('[GHL] beta tag remove failed:', e));

    // 3. Email the user — upgrade prompt
    const daysUsed = user.betaProExpiry
      ? Math.round((new Date().getTime() - (new Date(user.betaProExpiry).getTime() - 30 * 86400_000)) / 86400_000)
      : 30;

    sendMail({
      to:      user.email,
      subject: 'Your GasCap™ Pro trial has ended — keep the upgrades?',
      html: `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <div style="background:#1e3a5f;padding:28px 32px;">
            <h1 style="color:#fff;margin:0 0 6px;font-size:22px;font-weight:900;">Your Pro trial has ended ⏰</h1>
            <p style="color:rgba(255,255,255,0.65);margin:0;font-size:14px;">Your account is now on the free plan.</p>
          </div>
          <div style="padding:32px;">
            <p style="font-size:16px;color:#334155;margin:0 0 16px;">Hi ${user.name},</p>
            <p style="font-size:15px;color:#475569;line-height:1.65;margin:0 0 20px;">
              Your 30-day GasCap™ Pro beta trial has ended. Thank you for being one of our first testers — your feedback has been invaluable.
            </p>
            <p style="font-size:15px;color:#475569;line-height:1.65;margin:0 0 24px;">
              Your account is now on the free plan. All your data is safe. To keep the Pro features you've been using — ad-free experience, unlimited vehicles, full history, and budget goals — you can upgrade for just $4.99/month.
            </p>
            <div style="background:#fffbeb;border-radius:12px;padding:20px;margin:0 0 24px;border:1px solid #fde68a;">
              <p style="font-size:14px;font-weight:700;color:#92400e;margin:0 0 4px;">🎁 Beta tester discount</p>
              <p style="font-size:13px;color:#92400e;margin:0 0 16px;">As a thank-you for testing, use code <strong>BETA30</strong> for your first month free when you upgrade.</p>
              <a href="https://gascap.app/upgrade" style="display:inline-block;background:#f59e0b;color:#fff;padding:12px 28px;border-radius:10px;font-weight:900;font-size:14px;text-decoration:none;">Upgrade to Pro →</a>
            </div>
            <p style="font-size:13px;color:#94a3b8;line-height:1.6;margin:0;">No pressure — GasCap™ free is yours to keep forever. Reply anytime with questions or feedback.</p>
          </div>
          <div style="background:#f8fafc;padding:16px 32px;text-align:center;border-top:1px solid #e2e8f0;">
            <p style="font-size:11px;color:#94a3b8;margin:0;">© 2025 GasCap™ · <a href="https://gascap.app/privacy" style="color:#94a3b8;">Privacy Policy</a></p>
          </div>
        </div>
      `,
      text: `Hi ${user.name}, your 30-day GasCap Pro trial has ended. Upgrade at https://gascap.app/upgrade to keep Pro features ($4.99/mo). Use code BETA30 for your first month free.`,
    }).catch((e) => console.error('[GasCap] Beta expiry email failed:', e));

    results.push(`${user.name} <${user.email}>`);
    console.info(`[GasCap] Beta trial expired: ${user.email}`);
  }

  // 4. Notify admin
  sendMail({
    to:      'hello@gascap.app',
    subject: `⏰ ${expired.length} GasCap™ beta trial(s) expired`,
    html: `<div style="font-family:system-ui;max-width:480px;"><p style="font-size:16px;font-weight:700;">Beta trials reverted to free:</p><ul>${results.map((r) => `<li style="font-size:14px;color:#475569;">${r}</li>`).join('')}</ul></div>`,
    text:    `Beta trials expired:\n${results.join('\n')}`,
  }).catch(() => {});

  return NextResponse.json({ reverted: expired.length, users: results });
}
