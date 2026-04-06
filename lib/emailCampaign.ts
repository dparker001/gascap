/**
 * GasCap™ New-User Email Campaign
 *
 * 5-email drip sequence for all new free-plan sign-ups.
 *
 * Step 1 — Welcome          (immediate, fired in register route)
 * Step 2 — Feature tips     (day 3)
 * Step 3 — Pro upsell       (day 7)
 * Step 4 — Annual deal      (day 14)
 * Step 5 — Last-call offer  (day 30)
 *
 * Upgraded users (plan ≠ 'free') are skipped automatically.
 * Users who click Unsubscribe are flagged emailOptOut=true and excluded.
 */

import { sendMail } from './email';

// ── Shared layout helpers ──────────────────────────────────────────────────

const BASE_URL = process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? 'https://www.gascap.app';

function unsubLink(userId: string) {
  return `${BASE_URL}/api/email/unsubscribe?id=${userId}`;
}

function header() {
  return `
    <tr><td style="background:#1e2d4a;padding:24px 32px;border-radius:16px 16px 0 0;">
      <span style="color:#fff;font-size:20px;font-weight:900;letter-spacing:-0.5px;">
        GasCap<sup style="color:#f59e0b;font-size:11px;">™</sup>
      </span>
    </td></tr>`;
}

function footer(userId: string) {
  return `
    <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;border-radius:0 0 16px 16px;">
      <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.6;">
        GasCap™ · Know before you go ·
        <a href="https://www.gascap.app" style="color:#f59e0b;text-decoration:none;">gascap.app</a><br>
        <a href="${unsubLink(userId)}" style="color:#cbd5e1;text-decoration:underline;">Unsubscribe</a> from GasCap marketing emails
      </p>
    </td></tr>`;
}

function ctaButton(label: string, url: string) {
  return `
    <a href="${url}" style="display:inline-block;background:#f59e0b;color:#fff;font-weight:900;
       font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none;margin-top:4px;">
      ${label}
    </a>`;
}

function featureRow(emoji: string, title: string, desc: string) {
  return `
    <tr>
      <td style="padding:10px 0;vertical-align:top;width:32px;font-size:20px;">${emoji}</td>
      <td style="padding:10px 0 10px 12px;vertical-align:top;">
        <p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#1e2d4a;">${title}</p>
        <p style="margin:0;font-size:13px;color:#64748b;line-height:1.5;">${desc}</p>
      </td>
    </tr>`;
}

function wrap(body: string) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GasCap™</title></head>
<body style="margin:0;padding:0;background:#eef1f7;font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f7;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0"
             style="max-width:520px;background:#fff;border-radius:16px;
                    box-shadow:0 2px 16px rgba(0,0,0,.08);overflow:hidden;">
        ${body}
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

// ── Email 1 — Welcome (Immediate) ─────────────────────────────────────────

export function welcomeEmailHtml(name: string, userId: string): string {
  return wrap(`
    ${header()}
    <tr><td style="padding:32px;">
      <p style="margin:0 0 4px;font-size:26px;font-weight:900;color:#1e2d4a;">
        You're in, ${name.split(' ')[0]}! ⛽
      </p>
      <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
        Welcome to GasCap™ — the smart fuel calculator that helps you know exactly
        how much it costs before you pull into any gas station.
      </p>

      <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#1e2d4a;">
        Here's what you can do right now on your free account:
      </p>
      <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px;">
        ${featureRow('🔢', 'Target Fill Calculator', 'Enter your fuel level and tank size — see exactly what it'll cost to fill up.')}
        ${featureRow('💵', 'By Budget Calculator', 'Tell us your budget and we'll show how many gallons you can buy.')}
        ${featureRow('📍', 'Live Gas Price Lookup', 'Pull the current price at stations near you automatically.')}
        ${featureRow('🚗', '1 Saved Vehicle', 'Save your vehicle specs so calculations are instant every time.')}
      </table>

      ${ctaButton('Open GasCap Now →', BASE_URL)}

      <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Got questions? Just reply to this email — we read every one.
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const welcomeEmailText = (name: string) =>
  `Hi ${name}, welcome to GasCap™! You're all set on the free plan. Open the app: ${BASE_URL}`;

// ── Email 2 — Feature Tips (Day 3) ────────────────────────────────────────

export function featureTipsEmailHtml(name: string, userId: string): string {
  return wrap(`
    ${header()}
    <tr><td style="padding:32px;">
      <p style="margin:0 0 4px;font-size:22px;font-weight:900;color:#1e2d4a;">
        3 things GasCap can do that most people miss 🔍
      </p>
      <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
        Hey ${name.split(' ')[0]}, you've had GasCap for a few days —
        here are three features worth trying if you haven't already.
      </p>

      <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:8px;">
        ${featureRow('📍', 'Let GasCap find the gas price for you', 'Tap the location icon on the calculator — it pulls the current average price near you from the EIA database. No manual entry needed.')}
        ${featureRow('🏷️', 'Add your vehicle specs once, use forever', 'Save your tank size and fuel type in the Garage tab. Every calculation after that is one tap.')}
        ${featureRow('⭐', 'Earn badges as you use the app', 'Log fill-ups, hit streaks, and refer friends to unlock achievement badges. Check the Stats tab to see what you've earned.')}
      </table>

      <div style="background:#fefce8;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;margin:24px 0;">
        <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#92400e;">💡 Pro tip</p>
        <p style="margin:0;font-size:13px;color:#78350f;line-height:1.5;">
          Log your fill-ups after every visit and GasCap will automatically calculate
          your real-world MPG over time — and flag if it starts dropping.
        </p>
      </div>

      ${ctaButton('Try These Features →', BASE_URL)}
    </td></tr>
    ${footer(userId)}
  `);
}

export const featureTipsEmailText = (name: string) =>
  `Hi ${name}, here are 3 GasCap features worth trying: live gas price lookup, saved vehicle specs, and badge achievements. Open the app: ${BASE_URL}`;

// ── Email 3 — Pro Upsell (Day 7) ──────────────────────────────────────────

export function proUpsellEmailHtml(name: string, userId: string): string {
  return wrap(`
    ${header()}
    <tr><td style="padding:32px;">
      <p style="margin:0 0 4px;font-size:22px;font-weight:900;color:#1e2d4a;">
        Ready to unlock the good stuff? 🚀
      </p>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;">
        You've been using GasCap for a week, ${name.split(' ')[0]}.
        Here's what Pro users get that free users don't — and it's less than a cup of coffee a month.
      </p>

      <table cellpadding="0" cellspacing="0" width="100%"
             style="background:#f8fafc;border-radius:12px;padding:4px 16px;margin-bottom:20px;">
        ${featureRow('📊', 'MPG Trending Charts', 'See your real fuel efficiency over time across every vehicle you drive.')}
        ${featureRow('🤖', 'AI Fuel Advisor', 'Ask anything about your fuel costs, MPG trends, or upcoming trips — powered by Claude AI.')}
        ${featureRow('🎯', 'Monthly Budget Tracker', 'Set a monthly fuel budget and track your spending in real time.')}
        ${featureRow('🚗', 'Up to 5 Saved Vehicles', 'Perfect for households with multiple cars.')}
        ${featureRow('🔧', 'Maintenance Reminders', 'Oil change, tire rotation, and service alerts based on your mileage.')}
        ${featureRow('📄', 'Fuel Cost PDF Export', 'Download a monthly summary — great for reimbursements or expense reports.')}
      </table>

      <div style="text-align:center;padding:20px;background:linear-gradient(135deg,#1e2d4a,#2d4a6e);border-radius:14px;margin-bottom:24px;">
        <p style="margin:0 0 4px;color:rgba(255,255,255,.7);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">GasCap™ Pro</p>
        <p style="margin:0;color:#fff;font-size:32px;font-weight:900;">$4.99<span style="font-size:16px;font-weight:400;color:rgba(255,255,255,.6)">/mo</span></p>
        <p style="margin:4px 0 16px;color:#fbbf24;font-size:13px;font-weight:700;">or $49/yr — 2 months FREE</p>
        <a href="${BASE_URL}/upgrade" style="display:inline-block;background:#f59e0b;color:#fff;font-weight:900;
           font-size:15px;padding:13px 32px;border-radius:12px;text-decoration:none;">
          Upgrade to Pro →
        </a>
        <p style="margin:12px 0 0;color:rgba(255,255,255,.5);font-size:11px;">No contracts · Cancel anytime</p>
      </div>

      <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Not ready yet? No pressure — your free account is yours to keep forever.
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const proUpsellEmailText = (name: string) =>
  `Hi ${name}, GasCap Pro unlocks MPG charts, AI advisor, budget tracking, and more — $4.99/mo or $49/yr. Upgrade: ${BASE_URL}/upgrade`;

// ── Email 4 — Annual Deal + Social Proof (Day 14) ─────────────────────────

export function annualDealEmailHtml(name: string, userId: string): string {
  return wrap(`
    ${header()}
    <tr><td style="padding:32px;">
      <p style="margin:0 0 4px;font-size:22px;font-weight:900;color:#1e2d4a;">
        The smarter way to cut your fuel bill this year 💰
      </p>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;">
        ${name.split(' ')[0]}, most drivers overpay for fuel by $200–$600 a year
        simply because they don't know their numbers.
        GasCap Pro gives you the data to change that.
      </p>

      <table cellpadding="0" cellspacing="0" width="100%"
             style="border:2px solid #e2e8f0;border-radius:14px;overflow:hidden;margin-bottom:24px;">
        <tr style="background:#f1f5f9;">
          <td style="padding:12px 16px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">What Pro users track</td>
          <td style="padding:12px 16px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;text-align:right;">Avg. savings</td>
        </tr>
        <tr style="border-top:1px solid #e2e8f0;">
          <td style="padding:12px 16px;font-size:14px;color:#334155;">MPG drop alerts catch engine issues early</td>
          <td style="padding:12px 16px;font-size:14px;font-weight:700;color:#16a34a;text-align:right;">$150–$400/yr</td>
        </tr>
        <tr style="border-top:1px solid #e2e8f0;background:#fafafa;">
          <td style="padding:12px 16px;font-size:14px;color:#334155;">Budget tracker prevents overspending</td>
          <td style="padding:12px 16px;font-size:14px;font-weight:700;color:#16a34a;text-align:right;">$50–$150/yr</td>
        </tr>
        <tr style="border-top:1px solid #e2e8f0;">
          <td style="padding:12px 16px;font-size:14px;color:#334155;">Trip planning avoids costly detours</td>
          <td style="padding:12px 16px;font-size:14px;font-weight:700;color:#16a34a;text-align:right;">$30–$100/yr</td>
        </tr>
      </table>

      <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#1e2d4a;">
        Pay $49 once this year. Potentially save hundreds.
      </p>
      <p style="margin:0 0 20px;font-size:14px;color:#64748b;line-height:1.6;">
        The annual plan locks in 2 months free and is the most popular choice
        for drivers who want to stay on top of their fuel spending year-round.
      </p>

      <div style="display:flex;gap:12px;margin-bottom:24px;">
        ${ctaButton('Get Pro Annual — $49/yr →', `${BASE_URL}/upgrade`)}
      </div>

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;">
        <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#15803d;">🚐 Have multiple vehicles or a family?</p>
        <p style="margin:0;font-size:13px;color:#166534;line-height:1.5;">
          <strong>GasCap Fleet ($199/yr)</strong> covers unlimited vehicles, shared garage access,
          and per-vehicle spending breakdowns — ideal for households with 3+ cars
          or small business fleets.
          <a href="${BASE_URL}/upgrade" style="color:#16a34a;font-weight:700;">See Fleet →</a>
        </p>
      </div>
    </td></tr>
    ${footer(userId)}
  `);
}

export const annualDealEmailText = (name: string) =>
  `Hi ${name}, GasCap Pro ($49/yr) can help you save $200–$600 in fuel costs this year. See plans: ${BASE_URL}/upgrade`;

// ── Email 5 — Last Call (Day 30) ──────────────────────────────────────────

export function lastCallEmailHtml(name: string, userId: string): string {
  return wrap(`
    ${header()}
    <tr><td style="padding:32px;">
      <p style="margin:0 0 4px;font-size:22px;font-weight:900;color:#1e2d4a;">
        Still on Free? Here's our best offer 🎁
      </p>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;">
        ${name.split(' ')[0]}, you've been with GasCap for a month now.
        We love that you're here — and we want to make it easy to unlock everything.
      </p>

      <div style="text-align:center;background:linear-gradient(135deg,#fefce8,#fef3c7);
                  border:2px solid #fde68a;border-radius:16px;padding:28px 24px;margin-bottom:24px;">
        <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:1px;">
          🎁 Special offer
        </p>
        <p style="margin:0 0 8px;font-size:28px;font-weight:900;color:#1e2d4a;">
          GasCap™ Pro Annual
        </p>
        <p style="margin:0 0 4px;font-size:36px;font-weight:900;color:#d97706;">
          $49<span style="font-size:16px;font-weight:400;color:#92400e;">/year</span>
        </p>
        <p style="margin:0 0 20px;font-size:13px;color:#92400e;">
          That's <strong>$4.08/mo</strong> — less than a car wash
        </p>
        <a href="${BASE_URL}/upgrade" style="display:inline-block;background:#1e2d4a;color:#fff;font-weight:900;
           font-size:16px;padding:15px 40px;border-radius:14px;text-decoration:none;">
          Upgrade Now →
        </a>
        <p style="margin:14px 0 0;font-size:11px;color:#92400e;">Secure checkout via Stripe · Cancel anytime</p>
      </div>

      <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#1e2d4a;">
        What you'll unlock the moment you upgrade:
      </p>
      <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px;">
        ${featureRow('🤖', 'GasCap AI Advisor', 'Ask anything — fuel efficiency, cost predictions, maintenance timing.')}
        ${featureRow('📊', 'Full Charts & Analytics', 'MPG trends, spending history, price charts over time.')}
        ${featureRow('🎯', 'Budget + Spending Alerts', 'Know when you're about to blow your fuel budget before it happens.')}
        ${featureRow('🔧', 'Maintenance Reminders', 'Never miss an oil change or service interval again.')}
      </table>

      <p style="margin:0 0 4px;font-size:14px;color:#64748b;line-height:1.6;">
        If Pro isn't for you, that's completely okay — your free account
        is here as long as you want it. 🙌
      </p>
      <p style="margin:8px 0 0;font-size:13px;color:#94a3b8;">
        — The GasCap Team
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const lastCallEmailText = (name: string) =>
  `Hi ${name}, you've been on GasCap for a month. Upgrade to Pro for $49/yr and unlock AI, charts, and more. See plans: ${BASE_URL}/upgrade`;

// ── Campaign dispatch helper ───────────────────────────────────────────────

export interface CampaignRecipient {
  id:    string;
  name:  string;
  email: string;
}

export async function sendCampaignEmail(step: number, user: CampaignRecipient): Promise<void> {
  const { id, name, email } = user;

  const MAP: Record<number, { subject: string; html: string; text: string }> = {
    1: {
      subject: "Welcome to GasCap™ ⛽ — you're all set",
      html:    welcomeEmailHtml(name, id),
      text:    welcomeEmailText(name),
    },
    2: {
      subject: '3 things you might not know GasCap can do 🔍',
      html:    featureTipsEmailHtml(name, id),
      text:    featureTipsEmailText(name),
    },
    3: {
      subject: 'Ready to unlock the good stuff? GasCap Pro is $4.99/mo 🚀',
      html:    proUpsellEmailHtml(name, id),
      text:    proUpsellEmailText(name),
    },
    4: {
      subject: 'The smarter way to cut your fuel bill this year 💰',
      html:    annualDealEmailHtml(name, id),
      text:    annualDealEmailText(name),
    },
    5: {
      subject: "Still on Free? Here's our best offer 🎁",
      html:    lastCallEmailHtml(name, id),
      text:    lastCallEmailText(name),
    },
  };

  const mail = MAP[step];
  if (!mail) throw new Error(`Unknown campaign step: ${step}`);
  await sendMail({ to: email, ...mail });
}
