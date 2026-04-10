/**
 * GasCap™ New-User Email Campaign — 30-Day Pro Trial Drip
 *
 * Every new signup is automatically enrolled in a 30-day free GasCap™ Pro
 * trial (see grantNewSignupProTrial in lib/users.ts). These five emails
 * welcome them, teach them the Pro features they now have access to, and
 * guide them toward converting to a paid plan before the trial ends.
 *
 *   Step 1 — Welcome + Pro activated   (immediate, fired from register route)
 *   Step 2 — Feature deep-dive         (day 3   — 27 days of Pro left)
 *   Step 3 — Mid-trial value check-in  (day 10  — 20 days of Pro left)
 *   Step 4 — 9 days left, annual deal  (day 21  — lock in annual pricing)
 *   Step 5 — Final 48 hours            (day 28  — last-call offer)
 *
 * Users who already have a Stripe subscription are skipped automatically
 * by getUsersPendingCampaignStep. Users who click Unsubscribe are flagged
 * emailOptOut=true and excluded.
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
        <a href="${BASE_URL}" style="color:#f59e0b;text-decoration:none;">gascap.app</a><br>
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

/** Amber "trial badge" banner showing days remaining. Reused across emails. */
function trialBadge(daysLeft: number) {
  const color = daysLeft <= 5 ? '#dc2626' : daysLeft <= 10 ? '#d97706' : '#16a34a';
  return `
    <div style="display:inline-block;background:${color};color:#fff;font-weight:900;
                font-size:11px;padding:6px 12px;border-radius:20px;letter-spacing:0.5px;
                text-transform:uppercase;margin-bottom:14px;">
      ⭐ Pro trial · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left
    </div>`;
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
             style="max-width:560px;background:#fff;border-radius:16px;
                    box-shadow:0 2px 16px rgba(0,0,0,.08);overflow:hidden;">
        ${body}
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

// ── Email 1 — Welcome + Pro Activated (Day 0, immediate) ──────────────────

export function welcomeEmailHtml(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header()}
    <tr><td style="padding:32px;">
      ${trialBadge(30)}

      <p style="margin:0 0 6px;font-size:28px;font-weight:900;color:#1e2d4a;line-height:1.15;">
        Welcome to GasCap™, ${first}! 🎉
      </p>
      <p style="margin:0 0 18px;font-size:17px;font-weight:700;color:#f59e0b;">
        Your 30-day GasCap Pro trial is live — on us.
      </p>

      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">
        You just joined thousands of drivers who stopped guessing at the pump.
        As a welcome gift, every feature of <strong>GasCap™ Pro</strong> is unlocked on
        your account for the next 30 days — no credit card, no catch, no strings attached.
        We want you to experience everything GasCap can do before you decide whether
        it's worth keeping.
      </p>

      <div style="background:#1e2d4a;border-radius:14px;padding:24px;margin:0 0 24px;">
        <p style="margin:0 0 12px;font-size:12px;font-weight:900;color:#fbbf24;letter-spacing:1px;text-transform:uppercase;">
          🔓 What's now unlocked on your account
        </p>
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="padding:6px 0;vertical-align:top;width:28px;font-size:16px;">🤖</td>
            <td style="padding:6px 0 6px 10px;vertical-align:top;color:#fff;">
              <p style="margin:0;font-size:13px;font-weight:700;">GasCap AI Fuel Advisor</p>
              <p style="margin:0;font-size:12px;color:rgba(255,255,255,.65);line-height:1.5;">Ask anything about MPG, costs, or upcoming trips.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:6px 0;vertical-align:top;width:28px;font-size:16px;">📊</td>
            <td style="padding:6px 0 6px 10px;vertical-align:top;color:#fff;">
              <p style="margin:0;font-size:13px;font-weight:700;">MPG Trending Charts</p>
              <p style="margin:0;font-size:12px;color:rgba(255,255,255,.65);line-height:1.5;">Watch your real-world efficiency over time.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:6px 0;vertical-align:top;width:28px;font-size:16px;">🎯</td>
            <td style="padding:6px 0 6px 10px;vertical-align:top;color:#fff;">
              <p style="margin:0;font-size:13px;font-weight:700;">Monthly Budget Tracker</p>
              <p style="margin:0;font-size:12px;color:rgba(255,255,255,.65);line-height:1.5;">Set a fuel budget and get alerts before you blow it.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:6px 0;vertical-align:top;width:28px;font-size:16px;">🚗</td>
            <td style="padding:6px 0 6px 10px;vertical-align:top;color:#fff;">
              <p style="margin:0;font-size:13px;font-weight:700;">Up to 3 Saved Vehicles</p>
              <p style="margin:0;font-size:12px;color:rgba(255,255,255,.65);line-height:1.5;">Perfect for multi-car households.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:6px 0;vertical-align:top;width:28px;font-size:16px;">🔧</td>
            <td style="padding:6px 0 6px 10px;vertical-align:top;color:#fff;">
              <p style="margin:0;font-size:13px;font-weight:700;">Maintenance Reminders</p>
              <p style="margin:0;font-size:12px;color:rgba(255,255,255,.65);line-height:1.5;">Oil changes, rotations, and service alerts by mileage.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:6px 0;vertical-align:top;width:28px;font-size:16px;">📄</td>
            <td style="padding:6px 0 6px 10px;vertical-align:top;color:#fff;">
              <p style="margin:0;font-size:13px;font-weight:700;">Fuel Cost PDF Export</p>
              <p style="margin:0;font-size:12px;color:rgba(255,255,255,.65);line-height:1.5;">Great for expense reports or reimbursements.</p>
            </td>
          </tr>
        </table>
      </div>

      <p style="margin:0 0 14px;font-size:15px;font-weight:700;color:#1e2d4a;">
        Here's how to get the most out of your first week:
      </p>
      <ol style="margin:0 0 22px 20px;padding:0;font-size:14px;color:#475569;line-height:1.7;">
        <li><strong>Add your vehicle</strong> — tank size + fuel type, one time only.</li>
        <li><strong>Run a Target Fill calc</strong> — see exactly what a fill-up will cost before you pull in.</li>
        <li><strong>Try the AI Advisor</strong> — ask it "How much fuel will I need for a 300-mile trip?"</li>
        <li><strong>Set a monthly budget</strong> — GasCap will watch your spending for you.</li>
      </ol>

      ${ctaButton('Open GasCap Now →', BASE_URL)}

      <p style="margin:26px 0 0;font-size:13px;color:#64748b;line-height:1.65;">
        <strong>No surprises when your trial ends:</strong> your account will automatically
        revert to the free plan after 30 days — no charge, no auto-billing, nothing to cancel.
        If you love Pro (we think you will), you can upgrade anytime from the app.
      </p>
      <p style="margin:14px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Got questions? Just reply to this email — every message comes straight to the founder.
      </p>
      <p style="margin:18px 0 0;font-size:13px;color:#475569;">
        — The GasCap Team
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const welcomeEmailText = (name: string) =>
  `Hi ${name.split(' ')[0]}, welcome to GasCap™! Your 30-day free Pro trial is now active — AI Fuel Advisor, MPG charts, budget tracking, maintenance reminders, and PDF exports are all unlocked. No credit card needed, auto-reverts to free after 30 days. Open the app: ${BASE_URL}`;

// ── Email 2 — Feature Deep-Dive (Day 3) ───────────────────────────────────

export function featureTipsEmailHtml(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header()}
    <tr><td style="padding:32px;">
      ${trialBadge(27)}

      <p style="margin:0 0 6px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        3 Pro features to try this week, ${first} 🔥
      </p>
      <p style="margin:0 0 22px;font-size:15px;color:#475569;line-height:1.65;">
        You're 3 days into your free Pro trial — plenty of time to fall in love
        with the features paying members use every day. Here are three worth
        10 seconds of your time.
      </p>

      <div style="background:#f8fafc;border-radius:14px;padding:20px 24px;margin-bottom:18px;border-left:4px solid #f59e0b;">
        <p style="margin:0 0 6px;font-size:15px;font-weight:900;color:#1e2d4a;">🤖 Ask the AI Fuel Advisor anything</p>
        <p style="margin:0 0 10px;font-size:13px;color:#64748b;line-height:1.55;">
          The AI has your vehicle specs, your fill-up history, and current gas prices baked in.
          Try asking:
        </p>
        <ul style="margin:0 0 0 16px;padding:0;font-size:13px;color:#475569;line-height:1.6;">
          <li>"How much will a trip from Orlando to Atlanta cost me?"</li>
          <li>"Is my MPG trending down? What could be causing it?"</li>
          <li>"Should I fill up today or wait until Friday?"</li>
        </ul>
      </div>

      <div style="background:#f8fafc;border-radius:14px;padding:20px 24px;margin-bottom:18px;border-left:4px solid #10b981;">
        <p style="margin:0 0 6px;font-size:15px;font-weight:900;color:#1e2d4a;">📊 Pull up your MPG trending chart</p>
        <p style="margin:0;font-size:13px;color:#64748b;line-height:1.55;">
          Log two or three fill-ups and GasCap will start plotting your real-world
          miles-per-gallon over time. A sudden drop is often the earliest sign of
          an engine issue — catching it early can save hundreds in repairs.
        </p>
      </div>

      <div style="background:#f8fafc;border-radius:14px;padding:20px 24px;margin-bottom:24px;border-left:4px solid #6366f1;">
        <p style="margin:0 0 6px;font-size:15px;font-weight:900;color:#1e2d4a;">🎯 Set a monthly fuel budget</p>
        <p style="margin:0;font-size:13px;color:#64748b;line-height:1.55;">
          Tell GasCap what you want to spend on gas this month. It'll track every
          fill-up and ping you the moment you're at risk of going over — so you
          can adjust before it hits your bank account.
        </p>
      </div>

      ${ctaButton('Try These Pro Features →', BASE_URL)}

      <div style="background:#fefce8;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;margin:24px 0 0;">
        <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#92400e;">💡 Quick tip</p>
        <p style="margin:0;font-size:13px;color:#78350f;line-height:1.5;">
          Log a fill-up every time you gas up — even if it's just a few gallons. The more
          data the AI has, the smarter its recommendations get.
        </p>
      </div>

      <p style="margin:22px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Reply to this email if you get stuck or have a feature request — we read every one.
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const featureTipsEmailText = (name: string) =>
  `Hi ${name.split(' ')[0]}, you're 3 days into your GasCap Pro trial. Try these: AI Fuel Advisor (ask anything), MPG trending charts (catch engine issues early), and monthly budget tracker (never overspend). Open the app: ${BASE_URL}`;

// ── Email 3 — Mid-Trial Value Check-In (Day 10) ───────────────────────────

export function proUpsellEmailHtml(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header()}
    <tr><td style="padding:32px;">
      ${trialBadge(20)}

      <p style="margin:0 0 6px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        You're a third of the way through, ${first} 📊
      </p>
      <p style="margin:0 0 22px;font-size:15px;color:#475569;line-height:1.65;">
        Ten days into your free GasCap Pro trial — nice work. You still have 20 days to
        explore everything, and here are the features our power users swear by once they
        really dig in.
      </p>

      <table cellpadding="0" cellspacing="0" width="100%"
             style="background:#f8fafc;border-radius:12px;padding:4px 16px;margin-bottom:24px;">
        ${featureRow('🧠', 'AI trip planner', 'Plug in any origin, destination, and vehicle — get fuel cost, stops, and the cheapest stations en route.')}
        ${featureRow('📉', 'MPG drop detection', 'GasCap flags when your efficiency drops more than 10% — often the first sign of tire pressure, air filter, or fuel injector issues.')}
        ${featureRow('💰', 'Cost-per-mile tracking', 'See exactly what every mile costs you in fuel, broken down by vehicle. Perfect for gig drivers and sales reps.')}
        ${featureRow('📅', 'Service history log', 'Record oil changes, tire rotations, and repairs alongside your fill-ups. Resale value gold.')}
        ${featureRow('🏆', 'Unlimited badges + streaks', 'Free users are capped at 3 badges. Pro unlocks every achievement and the 365-day streak rewards.')}
        ${featureRow('📄', 'Monthly PDF fuel report', 'One-tap export of your whole month — miles driven, gallons burned, total spend, avg MPG. Expense-report ready.')}
      </table>

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:18px 22px;margin-bottom:22px;">
        <p style="margin:0 0 6px;font-size:14px;font-weight:900;color:#15803d;">
          💚 The most-loved Pro feature
        </p>
        <p style="margin:0;font-size:13px;color:#166534;line-height:1.6;">
          <strong>"The AI told me my MPG dropped 12% in two weeks. I checked, found an underinflated tire, and
          fixed it in five minutes. GasCap just paid for itself for a year."</strong> — Marcus J., Orlando
        </p>
      </div>

      <p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.65;">
        Twenty days still to go on your trial — use them. And if you love what you see,
        you can lock in Pro permanently starting at <strong>$4.99/month</strong> (or
        <strong>$49/year — 2 months free</strong>).
      </p>

      ${ctaButton('Open GasCap →', BASE_URL)}
      &nbsp;
      <a href="${BASE_URL}/upgrade" style="display:inline-block;background:#fff;color:#1e2d4a;border:2px solid #1e2d4a;font-weight:900;
         font-size:15px;padding:12px 28px;border-radius:12px;text-decoration:none;margin-top:4px;">
        See plans
      </a>

      <p style="margin:26px 0 0;font-size:12px;color:#94a3b8;line-height:1.6;">
        Reminder: your trial auto-reverts to the free plan on day 30. No card on file, no surprise charges.
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const proUpsellEmailText = (name: string) =>
  `Hi ${name.split(' ')[0]}, you're 10 days into your GasCap Pro trial — 20 days left. Power-user features to try: AI trip planner, MPG drop detection, cost-per-mile tracking, unlimited badges, PDF reports. Open the app: ${BASE_URL}`;

// ── Email 4 — 9 Days Left + Annual Deal (Day 21) ──────────────────────────

export function annualDealEmailHtml(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header()}
    <tr><td style="padding:32px;">
      ${trialBadge(9)}

      <p style="margin:0 0 6px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        9 days left — lock in Pro before it expires ⏰
      </p>
      <p style="margin:0 0 22px;font-size:15px;color:#475569;line-height:1.65;">
        ${first}, your free GasCap™ Pro trial wraps up in nine days.
        If GasCap has earned a spot on your phone, this is the moment to lock it in
        at the best price we offer — and avoid any disruption when your trial ends.
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
          <td style="padding:12px 16px;font-size:14px;color:#334155;">AI trip planning avoids detours</td>
          <td style="padding:12px 16px;font-size:14px;font-weight:700;color:#16a34a;text-align:right;">$30–$100/yr</td>
        </tr>
      </table>

      <div style="text-align:center;padding:24px 20px;background:linear-gradient(135deg,#1e2d4a,#2d4a6e);border-radius:14px;margin-bottom:22px;">
        <p style="margin:0 0 4px;color:rgba(255,255,255,.7);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Best value — most popular</p>
        <p style="margin:0;color:#fff;font-size:36px;font-weight:900;line-height:1;">$49<span style="font-size:16px;font-weight:400;color:rgba(255,255,255,.6)">/year</span></p>
        <p style="margin:6px 0 4px;color:#fbbf24;font-size:14px;font-weight:700;">That's just $4.08/mo</p>
        <p style="margin:0 0 18px;color:rgba(255,255,255,.6);font-size:12px;">2 months FREE vs monthly · cancel anytime</p>
        <a href="${BASE_URL}/upgrade" style="display:inline-block;background:#f59e0b;color:#fff;font-weight:900;
           font-size:15px;padding:14px 36px;border-radius:12px;text-decoration:none;">
          Upgrade to Pro Annual →
        </a>
        <p style="margin:14px 0 0;color:rgba(255,255,255,.5);font-size:11px;">Secure checkout via Stripe</p>
      </div>

      <p style="margin:0 0 10px;font-size:14px;color:#475569;line-height:1.65;">
        Prefer monthly? <a href="${BASE_URL}/upgrade" style="color:#f59e0b;font-weight:700;">GasCap Pro Monthly is $4.99/mo</a> —
        no contract, cancel anytime.
      </p>

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;margin-top:24px;">
        <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#15803d;">🚐 Multiple vehicles or a family?</p>
        <p style="margin:0;font-size:13px;color:#166534;line-height:1.5;">
          <strong>GasCap Fleet ($199/yr)</strong> covers unlimited vehicles, shared garage access,
          and per-vehicle spending breakdowns — ideal for households with 3+ cars or small business fleets.
          <a href="${BASE_URL}/upgrade" style="color:#16a34a;font-weight:700;">See Fleet →</a>
        </p>
      </div>

      <p style="margin:22px 0 0;font-size:12px;color:#94a3b8;line-height:1.6;">
        Your trial still has 9 days. If you don't upgrade, we'll automatically move you to the free plan — no charges, nothing to cancel.
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const annualDealEmailText = (name: string) =>
  `Hi ${name.split(' ')[0]}, your free GasCap Pro trial ends in 9 days. Lock in Pro Annual at $49/yr (just $4.08/mo — 2 months free) or monthly at $4.99. Upgrade: ${BASE_URL}/upgrade`;

// ── Email 5 — Final 48 Hours (Day 28) ─────────────────────────────────────

export function lastCallEmailHtml(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header()}
    <tr><td style="padding:32px;">
      ${trialBadge(2)}

      <p style="margin:0 0 6px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        Last 48 hours of your Pro trial 🚨
      </p>
      <p style="margin:0 0 22px;font-size:15px;color:#475569;line-height:1.65;">
        ${first}, in two days your GasCap™ Pro trial ends and your account moves back
        to the free plan. You've had 28 days to put it through its paces — here's the
        final, best-value way to keep everything you've been using.
      </p>

      <div style="text-align:center;background:linear-gradient(135deg,#fefce8,#fef3c7);
                  border:2px solid #fde68a;border-radius:16px;padding:28px 24px;margin-bottom:24px;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:1px;">
          🎁 Trial-ending offer
        </p>
        <p style="margin:0 0 8px;font-size:26px;font-weight:900;color:#1e2d4a;">
          GasCap™ Pro Annual
        </p>
        <p style="margin:0 0 4px;font-size:40px;font-weight:900;color:#d97706;line-height:1;">
          $49<span style="font-size:16px;font-weight:400;color:#92400e;">/year</span>
        </p>
        <p style="margin:6px 0 18px;font-size:13px;color:#92400e;">
          That's <strong>$4.08/mo</strong> — less than a car wash, less than a latte
        </p>
        <a href="${BASE_URL}/upgrade" style="display:inline-block;background:#1e2d4a;color:#fff;font-weight:900;
           font-size:16px;padding:15px 40px;border-radius:14px;text-decoration:none;">
          Upgrade Now →
        </a>
        <p style="margin:14px 0 0;font-size:11px;color:#92400e;">Secure checkout via Stripe · Cancel anytime</p>
      </div>

      <p style="margin:0 0 12px;font-size:15px;font-weight:700;color:#1e2d4a;">
        What you'll keep if you upgrade:
      </p>
      <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px;">
        ${featureRow('🤖', 'GasCap AI Fuel Advisor', 'Unlimited questions about fuel, MPG, trips, and maintenance.')}
        ${featureRow('📊', 'Full MPG + spending charts', 'Trends, history, and predictive alerts across every vehicle.')}
        ${featureRow('🎯', 'Budget + overspend alerts', 'Know when you\'re about to blow your fuel budget before it happens.')}
        ${featureRow('🔧', 'Maintenance reminders', 'Oil change, tire rotation, and service intervals — never forget one.')}
        ${featureRow('🚗', 'Up to 3 saved vehicles', 'Perfect for households with multiple cars.')}
        ${featureRow('📄', 'Monthly PDF fuel reports', 'Expense-report ready in one tap.')}
      </table>

      <p style="margin:0 0 14px;font-size:14px;color:#475569;line-height:1.65;">
        <strong>Not upgrading?</strong> That's completely okay. Your GasCap free account will still have
        the calculators, live gas price lookup, and one saved vehicle — yours forever, no charge. We'd
        just love to hear why so we can keep making GasCap better. Just hit reply.
      </p>

      <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Thanks for giving GasCap™ a fair shot, ${first}. 🙌
      </p>
      <p style="margin:8px 0 0;font-size:13px;color:#475569;">
        — The GasCap Team
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const lastCallEmailText = (name: string) =>
  `Hi ${name.split(' ')[0]}, your GasCap Pro trial ends in 48 hours. Lock in Pro Annual at $49/yr ($4.08/mo) before your account reverts to free. Upgrade: ${BASE_URL}/upgrade`;

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
      subject: "Welcome to GasCap™ — your 30-day Pro trial is live 🎉",
      html:    welcomeEmailHtml(name, id),
      text:    welcomeEmailText(name),
    },
    2: {
      subject: '3 Pro features to try this week 🔥 (27 days of Pro left)',
      html:    featureTipsEmailHtml(name, id),
      text:    featureTipsEmailText(name),
    },
    3: {
      subject: "You're 1/3 through your Pro trial — here's what to try next 📊",
      html:    proUpsellEmailHtml(name, id),
      text:    proUpsellEmailText(name),
    },
    4: {
      subject: '9 days left — lock in GasCap™ Pro before your trial ends ⏰',
      html:    annualDealEmailHtml(name, id),
      text:    annualDealEmailText(name),
    },
    5: {
      subject: 'Last 48 hours of your GasCap™ Pro trial 🚨',
      html:    lastCallEmailHtml(name, id),
      text:    lastCallEmailText(name),
    },
  };

  const mail = MAP[step];
  if (!mail) throw new Error(`Unknown campaign step: ${step}`);
  await sendMail({ to: email, ...mail });
}
