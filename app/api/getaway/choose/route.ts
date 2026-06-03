/**
 * POST /api/getaway/choose
 * A Lifetime buyer picks their complimentary getaway destination. We don't issue
 * the certificate automatically (no API on the free MB partner plan) — instead we
 * email the admin the exact destination to issue in Marketing Boost, and confirm
 * to the buyer that it's being sent.
 *
 * v1 is intentionally DB-less: the admin + buyer emails are the paper trail.
 * (A future version can persist the choice for an admin dashboard.)
 *
 * Body: { destination: string }  // one of GETAWAY_DESTINATIONS ids
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { findById }         from '@/lib/users';
import { sendMail }         from '@/lib/email';
import { getawayPromoActive, findGetawayDestination, GETAWAY_DISCLOSURE } from '@/lib/getawayPromo';

/** Fire-and-forget admin notification */
function notifyAdmin(opts: { subject: string; html: string; text: string }) {
  sendMail({ to: 'info@gascap.app', ...opts })
    .catch((e) => console.error('[GasCap] Getaway admin notify failed:', e));
}

export async function POST(req: Request) {
  if (!getawayPromoActive()) {
    return NextResponse.json({ error: 'The getaway promo is not active.' }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Sign in to choose your getaway.' }, { status: 401 });
  }

  let body: { destination?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const dest = findGetawayDestination(body.destination);
  if (!dest) {
    return NextResponse.json({ error: 'Please choose a valid destination.' }, { status: 400 });
  }

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const user   = await findById(userId);
  if (!user) {
    return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  }

  // Only Lifetime owners earn the getaway. (Defensive — the picker only shows to them.)
  if (user.stripeInterval !== 'lifetime') {
    return NextResponse.json({ error: 'The getaway is included with Pro Lifetime.' }, { status: 403 });
  }

  // ── Actionable admin email: which destination to issue, to whom ──────────────
  notifyAdmin({
    subject: `🏝️ ISSUE GETAWAY CERT → ${dest.name} → ${user.email}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;">
      <p style="font-size:20px;margin:0 0 8px;">🏝️ Issue a getaway certificate</p>
      <p style="font-size:15px;color:#334155;margin:0 0 4px;"><strong>${user.name}</strong> chose <strong>${dest.name}</strong>.</p>
      <p style="font-size:14px;color:#0f766e;margin:0 0 12px;"><strong>Action:</strong> In Marketing Boost → online-bookings vacation → issue a destination-based <strong>${dest.name}</strong> getaway to <strong>${user.email}</strong>.</p>
      <p style="font-size:13px;color:#64748b;margin:0 0 4px;">Recipient: <strong>${user.email}</strong> · Destination: <strong>${dest.name}</strong> (${dest.id})</p>
      <p style="font-size:12px;color:#94a3b8;">${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET</p>
    </div>`,
    text: `ISSUE GETAWAY CERT in Marketing Boost (online-bookings) — destination ${dest.name} → ${user.name} <${user.email}>`,
  });

  // ── Buyer confirmation ───────────────────────────────────────────────────────
  sendMail({
    to:      user.email,
    subject: `🏝️ Your ${dest.name} getaway is being sent`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;">
      <div style="background:linear-gradient(135deg,#005F4A,#1EB68F);border-radius:16px 16px 0 0;padding:24px;text-align:center;">
        <p style="font-size:26px;margin:0;color:#fff;font-weight:800;">${dest.emoji} ${dest.name}</p>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;padding:24px;">
        <p style="font-size:15px;color:#334155;margin:0 0 12px;">Great pick, ${user.name}! Your complimentary <strong>${dest.name}</strong> resort getaway certificate is being issued — watch your inbox (and spam folder) over the next <strong>24 hours</strong> for an email from Marketing Boost / RedeemVacations.</p>
        <div style="background:#f0fdf9;border:1px solid #99f6e4;border-radius:12px;padding:14px 16px;margin:0 0 12px;">
          <p style="font-size:12px;color:#0f766e;font-weight:800;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px;">Good to know</p>
          ${GETAWAY_DISCLOSURE.full.map((l) => `<p style="font-size:13px;color:#334155;margin:0 0 4px;">• ${l}</p>`).join('')}
        </div>
        <p style="font-size:13px;color:#64748b;margin:0;">Questions? Just reply to this email.</p>
      </div>
    </div>`,
    text: `Your ${dest.name} getaway certificate is being issued — watch your inbox within 24 hours. ${GETAWAY_DISCLOSURE.short}`,
  }).catch((e) => console.error('[GasCap] Getaway buyer confirmation failed:', e));

  console.info(`[GasCap] Getaway destination chosen: ${dest.name} by ${user.email}`);
  return NextResponse.json({ ok: true, destination: dest.id });
}
