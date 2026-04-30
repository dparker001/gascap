/**
 * GasCap™ Paid-User Email Campaign
 *
 * Fires after a user upgrades to a paid Pro or Fleet plan via Stripe.
 * Unlike the trial drip, these emails nurture retention and prevent churn.
 *
 *   P1 — Upgrade confirmation       (immediate, fired from Stripe webhook)
 *   P2 — 30-day check-in            (day 30 — cron)
 *   P3 — 60-day feature spotlight   (day 60 — cron)
 *   P4 — Annual renewal reminder    (day 330, annual subscribers only — cron)
 *   P5 — Cancellation / win-back    (immediate on subscription.deleted)
 *
 * Users who opt out (emailOptOut=true) are excluded by the cron query.
 */

import { sendMail, brandHeader } from './email';
import { logEmail }              from './emailLog';

const BASE_URL = process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? 'https://www.gascap.app';

function unsubLink(userId: string) {
  return `${BASE_URL}/api/email/unsubscribe?id=${userId}`;
}

function header(plan?: string) { return brandHeader(plan); }

function footer(userId: string) {
  return `
    <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;border-radius:0 0 16px 16px;">
      <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.6;">
        GasCap™ · Know before you go ·
        <a href="${BASE_URL}" style="color:#f59e0b;text-decoration:none;">gascap.app</a><br>
        <a href="${unsubLink(userId)}" style="color:#cbd5e1;text-decoration:underline;">Unsubscribe</a> from GasCap™ emails
      </p>
    </td></tr>`;
}

function wrap(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f7;font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f7;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;
             overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">
        ${content}
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

function ctaButton(label: string, url: string, color = '#005f4a') {
  return `
    <a href="${url}" style="display:inline-block;background:${color};color:#fff;font-weight:900;
       font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none;margin-top:4px;">
      ${label}
    </a>`;
}

// ── P1 — Upgrade Confirmation (immediate) ────────────────────────────────────

export function upgradeConfirmEmailHtml(
  name: string,
  userId: string,
  tier: 'pro' | 'fleet' = 'pro',
  interval: 'monthly' | 'annual' = 'monthly',
): string {
  const first      = name.split(' ')[0];
  const planLabel  = tier === 'fleet' ? 'GasCap™ Fleet' : 'GasCap™ Pro';
  const priceLabel = tier === 'fleet'
    ? (interval === 'annual' ? '$199/year' : '$19.99/month')
    : (interval === 'annual' ? '$49/year'  : '$4.99/month');
  const renewLabel = interval === 'annual' ? 'annually' : 'monthly';

  return wrap(`
    ${header(tier)}
    <tr><td style="padding:32px;">

      <p style="margin:0 0 6px;font-size:28px;font-weight:900;color:#1e2d4a;line-height:1.15;">
        Welcome to ${planLabel}, ${first}! 🎉
      </p>
      <p style="margin:0 0 22px;font-size:15px;color:#475569;line-height:1.65;">
        Your payment went through and your account is fully upgraded. Everything is unlocked —
        no trial countdown, no limitations. This is the full GasCap™ experience.
      </p>

      <div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:14px;
                  padding:22px 26px;margin:0 0 26px;">
        <p style="margin:0 0 4px;font-size:12px;font-weight:900;color:#15803d;
                  text-transform:uppercase;letter-spacing:.8px;">✅ Your plan</p>
        <p style="margin:0 0 2px;font-size:22px;font-weight:900;color:#1e2d4a;">${planLabel}</p>
        <p style="margin:0;font-size:14px;color:#475569;">${priceLabel} · renews ${renewLabel} · cancel anytime</p>
      </div>

      <p style="margin:0 0 14px;font-size:15px;font-weight:700;color:#1e2d4a;">
        What's fully unlocked on your account:
      </p>
      <table cellpadding="0" cellspacing="0" width="100%"
             style="background:#1e2d4a;border-radius:14px;padding:16px 20px;margin:0 0 24px;">
        ${(tier === 'fleet' ? [
          ['🚗', 'Unlimited vehicles',       'Add your entire fleet — no per-vehicle cap.'],
          ['👥', 'Multiple driver profiles',  'Separate fill-up tracking for each driver in your fleet.'],
          ['📊', 'Fleet dashboard',           'Centralized fuel spend, MPG, and efficiency across all vehicles.'],
          ['📄', 'Annual tax report',         'One-click PDF of annual fuel costs, ready for filing.'],
          ['🤖', 'AI Fuel Advisor',           'Unlimited questions on any vehicle — costs, MPG, trips, maintenance.'],
          ['🔧', 'Maintenance reminders',     'Service intervals and alerts for every vehicle in your fleet.'],
        ] : [
          ['🤖', 'AI Fuel Advisor',       'Unlimited questions — fuel costs, MPG, trips, maintenance.'],
          ['📊', 'MPG + spending charts', 'Full history, trends, and predictive drop alerts.'],
          ['🎯', 'Budget + alerts',        'Monthly fuel budget tracker with overspend notifications.'],
          ['🔧', 'Maintenance reminders', 'Oil changes, tire rotations, and service intervals.'],
          ['🚗', 'Up to 3 saved vehicles','Switch between cars in one tap.'],
          ['📄', 'Monthly PDF reports',   'Expense-report ready fuel summaries in one tap.'],
        ]).map(([icon, title, body]) => `
          <tr>
            <td style="padding:7px 0;vertical-align:top;width:28px;font-size:16px;">${icon}</td>
            <td style="padding:7px 0 7px 10px;vertical-align:top;">
              <p style="margin:0;font-size:13px;font-weight:700;color:#fff;">${title}</p>
              <p style="margin:0;font-size:12px;color:rgba(255,255,255,.6);line-height:1.45;">${body}</p>
            </td>
          </tr>`).join('')}
      </table>

      ${ctaButton('Open GasCap™ →', BASE_URL)}

      <p style="margin:26px 0 0;font-size:13px;color:#64748b;line-height:1.65;">
        Questions about your subscription? Email
        <a href="mailto:support@gascap.app" style="color:#005f4a;font-weight:600;">support@gascap.app</a>
        or just reply to this email — it comes straight to me.
      </p>
      <p style="margin:12px 0 0;font-size:13px;color:#475569;">
        — Don, Founder of GasCap™
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const upgradeConfirmEmailText = (name: string, tier: 'pro' | 'fleet', interval: 'monthly' | 'annual') =>
  `Hi ${name.split(' ')[0]}, your GasCap™ ${tier === 'fleet' ? 'Fleet' : 'Pro'} subscription is active (${interval}). Everything is unlocked — no trial countdown. Open the app: ${BASE_URL}`;

// ── P2 — 30-Day Check-In ─────────────────────────────────────────────────────

export function paidCheckInEmailHtml(name: string, userId: string, tier: 'pro' | 'fleet' = 'pro'): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header(tier)}
    <tr><td style="padding:32px;">

      <p style="margin:0 0 6px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        One month in — are you getting the most out of Pro? 📊
      </p>
      <p style="margin:0 0 22px;font-size:15px;color:#475569;line-height:1.65;">
        ${first}, you've been a GasCap™ Pro member for 30 days. Thank you — genuinely.
        Here are three features that Pro members tell us make the biggest difference once
        they really settle in.
      </p>

      <div style="background:#f8fafc;border-radius:14px;padding:20px 24px;
                  margin-bottom:16px;border-left:4px solid #005f4a;">
        <p style="margin:0 0 5px;font-size:15px;font-weight:900;color:#1e2d4a;">
          📉 Set up MPG drop detection
        </p>
        <p style="margin:0;font-size:13px;color:#64748b;line-height:1.55;">
          If you've logged at least 3 fill-ups, GasCap™ is already tracking your efficiency.
          A drop of 10% or more triggers an alert — often the first sign of low tire pressure,
          a clogged air filter, or a fuel injector issue. Catching it early typically saves
          $150–$400 in repair costs.
        </p>
      </div>

      <div style="background:#f8fafc;border-radius:14px;padding:20px 24px;
                  margin-bottom:16px;border-left:4px solid #f59e0b;">
        <p style="margin:0 0 5px;font-size:15px;font-weight:900;color:#1e2d4a;">
          🎯 Review your monthly fuel budget
        </p>
        <p style="margin:0;font-size:13px;color:#64748b;line-height:1.55;">
          If you haven't set a fuel budget yet, now's a great time — you have a full month
          of real spend data to base it on. GasCap™ will alert you before you go over, not after.
        </p>
      </div>

      <div style="background:#f8fafc;border-radius:14px;padding:20px 24px;
                  margin-bottom:24px;border-left:4px solid #6366f1;">
        <p style="margin:0 0 5px;font-size:15px;font-weight:900;color:#1e2d4a;">
          📄 Export your first monthly report
        </p>
        <p style="margin:0;font-size:13px;color:#64748b;line-height:1.55;">
          One tap generates a PDF of the full month — miles driven, gallons burned,
          total spend, avg MPG. Perfect for expense reimbursements, small business records,
          or just tracking your fuel costs over time.
        </p>
      </div>

      ${ctaButton('Open GasCap™ →', BASE_URL)}

      <p style="margin:26px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Not using a feature? Hit reply and let us know — we use that feedback to improve the app.
      </p>
      <p style="margin:10px 0 0;font-size:13px;color:#475569;">
        — The GasCap™ Team
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const paidCheckInEmailText = (name: string) =>
  `Hi ${name.split(' ')[0]}, you've been a GasCap™ Pro member for 30 days. Three things worth trying: MPG drop detection (set up alerts for engine issue warnings), monthly fuel budget (review based on your real spend data), and PDF export (one-tap fuel report). Open the app: ${BASE_URL}`;

// ── P3 — 60-Day Feature Spotlight ────────────────────────────────────────────

export function paidSpotlightEmailHtml(name: string, userId: string, tier: 'pro' | 'fleet' = 'pro'): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header(tier)}
    <tr><td style="padding:32px;">

      <p style="margin:0 0 6px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        The Pro feature most people discover too late 🧠
      </p>
      <p style="margin:0 0 22px;font-size:15px;color:#475569;line-height:1.65;">
        ${first}, two months in. We want to make sure you're getting real value — so here's
        the feature that consistently gets the most "I didn't know it did that" reactions
        from Pro members.
      </p>

      <div style="background:#1e2d4a;border-radius:16px;padding:28px 26px;margin:0 0 24px;">
        <p style="margin:0 0 10px;font-size:19px;font-weight:900;color:#fbbf24;">
          🤖 The AI Fuel Advisor knows your car
        </p>
        <p style="margin:0 0 16px;font-size:13px;color:rgba(255,255,255,.75);line-height:1.6;">
          Most people use it for one thing and never go deeper. But the AI has your vehicle
          specs, your entire fill-up history, your MPG trend, your local gas prices, and
          your monthly budget all baked in. That means it can answer questions nobody else can:
        </p>
        <table cellpadding="0" cellspacing="0" width="100%">
          ${[
            '"My MPG dropped this week — what\'s most likely causing it?"',
            '"How much will it cost to drive from Tampa to Atlanta this weekend?"',
            '"Am I on track to stay under my $120 fuel budget this month?"',
            '"Which of my two cars is cheaper to run per mile right now?"',
          ].map(q => `
            <tr>
              <td style="padding:5px 0;vertical-align:top;width:18px;">
                <span style="color:#fbbf24;font-size:13px;">›</span>
              </td>
              <td style="padding:5px 0 5px 8px;">
                <p style="margin:0;font-size:13px;color:#fff;line-height:1.5;font-style:italic;">${q}</p>
              </td>
            </tr>`).join('')}
        </table>
      </div>

      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:12px;
                  padding:18px 22px;margin:0 0 24px;">
        <p style="margin:0 0 6px;font-size:13px;font-weight:900;color:#92400e;">
          💚 From a Pro member
        </p>
        <p style="margin:0;font-size:13px;color:#78350f;line-height:1.6;font-style:italic;">
          "I drive a lot for work and never tracked my gas spend closely. The AI Advisor
          flagged that my F-150 was burning about 12% more than expected. Tires were 8 PSI
          low — fixed in 10 minutes at the pump. Saves me roughly $40 a month now."
        </p>
        <p style="margin:8px 0 0;font-size:12px;color:#92400e;font-weight:700;">— Derek T., Houston</p>
      </div>

      ${ctaButton('Ask the AI Advisor →', BASE_URL)}

      <p style="margin:26px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Reply to this email with any questions or feedback — we read every one.
      </p>
      <p style="margin:10px 0 0;font-size:13px;color:#475569;">
        — The GasCap™ Team
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const paidSpotlightEmailText = (name: string) =>
  `Hi ${name.split(' ')[0]}, two months in. The most underused Pro feature: the AI Fuel Advisor knows your vehicle, fill-up history, MPG trend, and budget — ask it anything. "Why did my MPG drop?" "How much to drive to Atlanta?" "Am I on track this month?" Open the app: ${BASE_URL}`;

// ── P4 — Annual Renewal Reminder (annual only, day 330) ──────────────────────

export function renewalReminderEmailHtml(name: string, userId: string, tier: 'pro' | 'fleet' = 'pro'): string {
  const first      = name.split(' ')[0];
  const planLabel  = tier === 'fleet' ? 'GasCap™ Fleet' : 'GasCap™ Pro';
  const price      = tier === 'fleet' ? '$199' : '$49';
  const perMonth   = tier === 'fleet' ? '$16.58/mo' : '$4.08/mo';
  const valueNote  = tier === 'fleet' ? 'less than 4 tanks of gas per year' : 'less than a single gallon of gas';
  return wrap(`
    ${header(tier)}
    <tr><td style="padding:32px;">

      <p style="margin:0 0 6px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        Your ${planLabel} renews in 30 days 📅
      </p>
      <p style="margin:0 0 22px;font-size:15px;color:#475569;line-height:1.65;">
        ${first}, your annual ${planLabel} subscription renews in about 30 days at ${price}.
        We wanted to give you a heads-up — and a quick look at what the year looked like.
      </p>

      <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:14px;
                  padding:22px 26px;margin:0 0 24px;">
        <p style="margin:0 0 14px;font-size:13px;font-weight:900;color:#1e2d4a;
                  text-transform:uppercase;letter-spacing:.6px;">What Pro gave you this year</p>
        ${[
          ['⛽', 'Fill-up tracking',     'Every gallon logged, every dollar recorded.'],
          ['📉', 'MPG drop alerts',      'Early warning for mechanical issues before they get expensive.'],
          ['🎯', 'Budget enforcement',   'Overspend alerts kept your fuel costs predictable.'],
          ['🤖', 'AI advisor answers',   'Your personal fuel expert, always available.'],
          ['📄', 'Monthly PDF reports',  'Expense-ready fuel summaries, every month.'],
        ].map(([icon, title, body]) => `
          <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:10px;"><tr>
            <td style="vertical-align:top;width:28px;font-size:16px;padding-top:2px;">${icon}</td>
            <td style="vertical-align:top;padding-left:10px;">
              <p style="margin:0;font-size:13px;font-weight:700;color:#1e2d4a;">${title}</p>
              <p style="margin:0;font-size:12px;color:#64748b;line-height:1.45;">${body}</p>
            </td>
          </tr></table>`).join('')}
      </div>

      <div style="text-align:center;background:linear-gradient(135deg,#1e2d4a,#2d4a6e);
                  border-radius:14px;padding:24px 20px;margin:0 0 22px;">
        <p style="margin:0 0 4px;color:rgba(255,255,255,.6);font-size:12px;font-weight:700;
                  text-transform:uppercase;letter-spacing:1px;">Renewing at</p>
        <p style="margin:0;color:#fff;font-size:36px;font-weight:900;line-height:1.1;">
          ${price}<span style="font-size:16px;font-weight:400;color:rgba(255,255,255,.6)">/year</span>
        </p>
        <p style="margin:6px 0 18px;color:#fbbf24;font-size:13px;">
          That's ${perMonth} — ${valueNote}
        </p>
        <a href="${BASE_URL}/settings" style="display:inline-block;background:#f59e0b;color:#fff;
           font-weight:900;font-size:14px;padding:12px 28px;border-radius:12px;text-decoration:none;">
          Manage subscription →
        </a>
      </div>

      <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
        If you'd like to cancel before renewal, you can do so anytime in
        <a href="${BASE_URL}/settings" style="color:#005f4a;font-weight:600;">Settings</a>.
        No fees, no questions asked. But we'd love to keep you — and we have more features
        on the way this year.
      </p>
      <p style="margin:16px 0 0;font-size:13px;color:#475569;">
        — The GasCap™ Team
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const renewalReminderEmailText = (name: string, tier: 'pro' | 'fleet' = 'pro') => {
  const planLabel = tier === 'fleet' ? 'GasCap™ Fleet' : 'GasCap™ Pro';
  const price     = tier === 'fleet' ? '$199 ($16.58/mo)' : '$49 ($4.08/mo)';
  return `Hi ${name.split(' ')[0]}, your ${planLabel} annual subscription renews in ~30 days at ${price}. To manage or cancel, visit: ${BASE_URL}/settings. Thanks for a great year with us.`;
};

// ── P5 — Cancellation / Win-Back (immediate on subscription.deleted) ─────────

export function cancellationEmailHtml(name: string, userId: string, tier: 'pro' | 'fleet' = 'pro'): string {
  const first         = name.split(' ')[0];
  const planLabel     = tier === 'fleet' ? 'Fleet' : 'Pro';
  const couponCode    = tier === 'fleet' ? 'BETA30'           : 'TRIAL30';
  const reactivateCta = tier === 'fleet' ? 'Reactivate Fleet →' : 'Reactivate Pro →';
  return wrap(`
    ${header(tier)}
    <tr><td style="padding:32px;">

      <p style="margin:0 0 6px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        Your GasCap™ ${planLabel} subscription has been cancelled
      </p>
      <p style="margin:0 0 22px;font-size:15px;color:#475569;line-height:1.65;">
        ${first}, your ${planLabel} subscription has ended and your account has moved to the free plan.
        Your data — fill-up history, vehicles, badges, and streaks — is all still here.
      </p>

      <div style="background:#f8fafc;border-radius:12px;padding:20px 24px;margin:0 0 24px;">
        <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:#1e2d4a;">
          What you still have on the free plan:
        </p>
        ${[
          ['⛽', 'Fuel calculator',     'Target Fill, Cost-to-Fill, and MPG calculator — always free.'],
          ['📍', 'Live gas price lookup','Real-time local gas prices near you.'],
          ['🚗', '1 saved vehicle',     'Your garage stays, limited to one active vehicle.'],
          ['🏆', 'Badges & streaks',    'Your existing achievements are safe.'],
        ].map(([icon, title, body]) => `
          <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:8px;"><tr>
            <td style="vertical-align:top;width:24px;font-size:15px;">${icon}</td>
            <td style="vertical-align:top;padding-left:10px;">
              <p style="margin:0;font-size:13px;font-weight:700;color:#334155;">${title}</p>
              <p style="margin:0;font-size:12px;color:#64748b;line-height:1.45;">${body}</p>
            </td>
          </tr></table>`).join('')}
      </div>

      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;
                  padding:18px 22px;margin:0 0 24px;">
        <p style="margin:0 0 6px;font-size:13px;font-weight:900;color:#92400e;">
          🎁 Come back anytime — first month on us
        </p>
        <p style="margin:0 0 14px;font-size:13px;color:#92400e;line-height:1.55;">
          If you change your mind, use code <strong>${couponCode}</strong> at checkout for your
          first month back free. No pressure — the offer doesn't expire.
        </p>
        ${ctaButton(reactivateCta, `${BASE_URL}/upgrade`, '#f59e0b')}
      </div>

      <p style="margin:0 0 14px;font-size:14px;color:#475569;line-height:1.65;">
        We'd genuinely love to know what we could have done better. Just hit reply — every
        response reaches me directly, and we use this feedback to improve.
      </p>
      <p style="margin:0;font-size:13px;color:#475569;">
        — Don, Founder of GasCap™
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const cancellationEmailText = (name: string, tier: 'pro' | 'fleet' = 'pro') => {
  const planLabel  = tier === 'fleet' ? 'Fleet' : 'Pro';
  const couponCode = tier === 'fleet' ? 'BETA30' : 'TRIAL30';
  return `Hi ${name.split(' ')[0]}, your GasCap™ ${planLabel} subscription has ended. Your free account keeps the calculator, live gas prices, 1 saved vehicle, and all your badges. Want to come back? Use code ${couponCode} for your first month back free: ${BASE_URL}/upgrade. Hit reply if there's anything we could improve.`;
};

// ── Dispatch helper ───────────────────────────────────────────────────────────

export interface PaidCampaignRecipient {
  id:       string;
  name:     string;
  email:    string;
  tier?:    'pro' | 'fleet';
  interval?: 'monthly' | 'annual';
}

export async function sendPaidCampaignEmail(
  step: 'P1' | 'P2' | 'P3' | 'P4' | 'P5',
  user: PaidCampaignRecipient,
): Promise<void> {
  const { id, name, email, tier = 'pro', interval = 'monthly' } = user;

  const MAP: Record<string, { subject: string; html: string; text: string }> = {
    P1: {
      subject: `You're officially GasCap™ ${tier === 'fleet' ? 'Fleet' : 'Pro'} 🎉`,
      html:    upgradeConfirmEmailHtml(name, id, tier, interval),
      text:    upgradeConfirmEmailText(name, tier, interval),
    },
    P2: {
      subject: 'One month with GasCap™ Pro — are you getting the most out of it? 📊',
      html:    paidCheckInEmailHtml(name, id),
      text:    paidCheckInEmailText(name),
    },
    P3: {
      subject: 'The GasCap™ Pro feature most people discover too late 🧠',
      html:    paidSpotlightEmailHtml(name, id),
      text:    paidSpotlightEmailText(name),
    },
    P4: {
      subject: `Your GasCap™ ${tier === 'fleet' ? 'Fleet' : 'Pro'} renews in 30 days — here's your year in review 📅`,
      html:    renewalReminderEmailHtml(name, id, tier),
      text:    renewalReminderEmailText(name, tier),
    },
    P5: {
      subject: `Your GasCap™ ${tier === 'fleet' ? 'Fleet' : 'Pro'} subscription has been cancelled`,
      html:    cancellationEmailHtml(name, id, tier),
      text:    cancellationEmailText(name, tier),
    },
  };

  const mail = MAP[step];
  if (!mail) throw new Error(`Unknown paid campaign step: ${step}`);
  await sendMail({ to: email, ...mail });
  logEmail({ userId: id, userEmail: email, userName: name, type: `paid-${step.toLowerCase()}`, subject: mail.subject }).catch(() => {});
}
