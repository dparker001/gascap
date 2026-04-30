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

import { sendMail, brandHeader } from './email';
import { logEmail }              from './emailLog';

// ── Shared layout helpers ──────────────────────────────────────────────────

const BASE_URL = process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? 'https://www.gascap.app';

function unsubLink(userId: string) {
  return `${BASE_URL}/api/email/unsubscribe?id=${userId}`;
}

/** Wrapper that returns the shared GasCap™ brand header (logo pill on navy). */
function header(plan?: string) {
  return brandHeader(plan);
}

function footer(userId: string) {
  return `
    <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;border-radius:0 0 16px 16px;">
      <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.6;">
        GasCap™ · Know before you go ·
        <a href="${BASE_URL}" style="color:#f59e0b;text-decoration:none;">gascap.app</a><br>
        <a href="${unsubLink(userId)}" style="color:#cbd5e1;text-decoration:underline;">Unsubscribe</a> from GasCap™ marketing emails
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

export function welcomeEmailHtml(name: string, userId: string, verifyUrl?: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header('trial')}
    <tr><td style="padding:32px;">
      ${trialBadge(30)}

      <p style="margin:0 0 6px;font-size:28px;font-weight:900;color:#1e2d4a;line-height:1.15;">
        Welcome to GasCap™, ${first}! 🎉
      </p>
      <p style="margin:0 0 18px;font-size:17px;font-weight:700;color:#f59e0b;">
        Your 30-day GasCap™ Pro trial is live — on us.
      </p>

      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">
        You just joined thousands of drivers who stopped guessing at the pump.
        As a welcome gift, every feature of <strong>GasCap™ Pro</strong> is unlocked on
        your account for the next 30 days — no credit card, no catch, no strings attached.
        We want you to experience everything GasCap™ can do before you decide whether
        it's worth keeping.
      </p>

      <div style="background:#1e2d4a;border-radius:14px;padding:24px;margin:0 0 24px;">
        <p style="margin:0 0 12px;font-size:12px;font-weight:900;color:#fbbf24;letter-spacing:1px;text-transform:uppercase;">
          🔓 What's now unlocked on your account
        </p>
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="padding:6px 0;vertical-align:top;width:28px;font-size:16px;">🚗</td>
            <td style="padding:6px 0 6px 10px;vertical-align:top;color:#fff;">
              <p style="margin:0;font-size:13px;font-weight:700;">Rental Car Return Mode</p>
              <p style="margin:0;font-size:12px;color:rgba(255,255,255,.65);line-height:1.5;">Never overpay at return. Calculates the exact gallons to buy before dropping off.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:6px 0;vertical-align:top;width:28px;font-size:16px;">🤖</td>
            <td style="padding:6px 0 6px 10px;vertical-align:top;color:#fff;">
              <p style="margin:0;font-size:13px;font-weight:700;">GasCap™ AI Fuel Advisor</p>
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
              <p style="margin:0;font-size:13px;font-weight:700;">Your Garage — Up to 3 Vehicles</p>
              <p style="margin:0;font-size:12px;color:rgba(255,255,255,.65);line-height:1.5;">Save up to 3 cars in your personal garage. Switch between them in one tap.</p>
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

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:18px 22px;margin:0 0 22px;">
        <p style="margin:0 0 6px;font-size:14px;font-weight:900;color:#14532d;">
          🎁 Monthly Gas Card Giveaway — you're already entered
        </p>
        <p style="margin:0;font-size:13px;color:#166534;line-height:1.6;">
          Every day you <strong>log in or use GasCap™</strong> earns you an entry for that month's
          $25 Visa prepaid card drawing. The more days you're active, the better your odds. Drawing is held
          monthly — free to enter, no purchase required.
        </p>
      </div>

      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:12px;padding:18px 22px;margin:0 0 22px;">
        <p style="margin:0 0 6px;font-size:14px;font-weight:900;color:#92400e;">
          🚗 Renting a car? Don't miss our most-loved feature
        </p>
        <p style="margin:0;font-size:13px;color:#78350f;line-height:1.6;">
          <strong>Rental Car Return Mode</strong> tells you exactly how many gallons to
          buy before drop-off — so you don't overpay the $10–$12/gallon refueling fee
          or waste money over-filling a tank you're about to hand back. Toggle
          "🚗 Rental Car Return?" on the calculator and enter the rental company's
          fuel rate to see your exact savings in real time. It alone pays for Pro
          on a single trip.
        </p>
      </div>

      <p style="margin:0 0 14px;font-size:15px;font-weight:700;color:#1e2d4a;">
        Here's how to get the most out of your first week:
      </p>
      <ol style="margin:0 0 22px 20px;padding:0;font-size:14px;color:#475569;line-height:1.7;">
        <li><strong>Add your vehicle</strong> — tank size + fuel type, one time only.</li>
        <li><strong>Run a Target Fill calc</strong> — see exactly what a fill-up will cost before you pull in.</li>
        <li><strong>Try Rental Car Return Mode</strong> next time you rent — avoid the $12/gal refuel trap.</li>
        <li><strong>Try the AI Advisor</strong> — ask it "How much fuel will I need for a 300-mile trip?"</li>
        <li><strong>Set a monthly budget</strong> — GasCap™ will watch your spending for you.</li>
      </ol>

      ${ctaButton('Open GasCap™ Now →', BASE_URL)}

      <p style="margin:26px 0 0;font-size:13px;color:#64748b;line-height:1.65;">
        <strong>No surprises when your trial ends:</strong> your account will automatically
        revert to the free plan after 30 days — no charge, no auto-billing, nothing to cancel.
        If you love Pro (we think you will), you can upgrade anytime from the app.
      </p>
      <p style="margin:14px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Got questions? Just reply to this email — it reaches me directly.
      </p>

      ${verifyUrl ? `
      <div style="background:#fef9f0;border:1px solid #fed7aa;border-radius:12px;padding:16px 20px;margin-top:24px;">
        <p style="margin:0 0 6px;font-size:13px;font-weight:900;color:#c2410c;">
          📧 One quick thing — verify your email
        </p>
        <p style="margin:0 0 12px;font-size:13px;color:#7c2d12;line-height:1.6;">
          We sent you a separate verification email. Clicking the link takes just a second
          and keeps your account secure. If you don't see it, check your spam folder or
          use the button below.
        </p>
        <a href="${verifyUrl}" style="display:inline-block;background:#f59e0b;color:#fff;font-weight:900;
           font-size:13px;padding:10px 22px;border-radius:10px;text-decoration:none;">
          ✓ Verify My Email
        </a>
      </div>` : ''}

      <p style="margin:18px 0 0;font-size:13px;color:#475569;">
        — Don, Founder of GasCap™
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const welcomeEmailText = (name: string) =>
  `Hi ${name.split(' ')[0]}, welcome to GasCap™! Your 30-day free Pro trial is now active — Rental Car Return Mode (avoid $12/gal refuel fees), AI Fuel Advisor, MPG charts, budget tracking, maintenance reminders, and PDF exports are all unlocked. No credit card needed, auto-reverts to free after 30 days. Open the app: ${BASE_URL}`;

// ── Email 2 — Feature Deep-Dive (Day 3) ───────────────────────────────────

export function featureTipsEmailHtml(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header('trial')}
    <tr><td style="padding:32px;">
      ${trialBadge(27)}

      <p style="margin:0 0 6px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        4 Pro features to try this week, ${first} ⚡
      </p>
      <p style="margin:0 0 22px;font-size:15px;color:#475569;line-height:1.65;">
        You're 3 days into your free Pro trial — plenty of time to fall in love
        with the features paying members use every day. Here are four worth
        10 seconds of your time (including the one that can literally pay for
        Pro on a single rental car trip).
      </p>

      <div style="background:#f8fafc;border-radius:14px;padding:20px 24px;margin-bottom:18px;border-left:4px solid #dc2626;">
        <p style="margin:0 0 6px;font-size:15px;font-weight:900;color:#1e2d4a;">🚗 Rental Car Return Mode</p>
        <p style="margin:0 0 10px;font-size:13px;color:#64748b;line-height:1.55;">
          Rental companies charge <strong>$10–$12 per gallon</strong> when you return a car with less
          than a full tank — often adding $60+ to a trip. GasCap™'s Rental Car Return
          Mode calculates the exact number of gallons to buy at the pump before
          drop-off, using the car's current fuel level and tank size. Toggle
          "🚗 Rental Car Return?" on the calculator, drop in the rental company's
          refuel rate, and GasCap™ shows your exact savings in real time — typically
          $30–$80 per trip. This feature alone pays for a full year of Pro on one rental.
        </p>
      </div>

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
          Log two or three fill-ups and GasCap™ will start plotting your real-world
          miles-per-gallon over time. A sudden drop is often the earliest sign of
          an engine issue — catching it early can save hundreds in repairs.
        </p>
      </div>

      <div style="background:#f8fafc;border-radius:14px;padding:20px 24px;margin-bottom:24px;border-left:4px solid #6366f1;">
        <p style="margin:0 0 6px;font-size:15px;font-weight:900;color:#1e2d4a;">🎯 Set a monthly fuel budget</p>
        <p style="margin:0;font-size:13px;color:#64748b;line-height:1.55;">
          Tell GasCap™ what you want to spend on gas this month. It'll track every
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
      <p style="margin:10px 0 0;font-size:13px;color:#475569;">
        — The GasCap™ Team
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const featureTipsEmailText = (name: string) =>
  `Hi ${name.split(' ')[0]}, you're 3 days into your GasCap™ Pro trial. Try these: Rental Car Return Mode (avoid the $12/gal refuel trap on rentals — pays for Pro in a single trip), AI Fuel Advisor (ask anything), MPG trending charts (catch engine issues early), and monthly budget tracker (never overspend). Open the app: ${BASE_URL}`;

// ── Email 3 — Mid-Trial Value Check-In (Day 10) ───────────────────────────

export function proUpsellEmailHtml(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header('trial')}
    <tr><td style="padding:32px;">
      ${trialBadge(20)}

      <p style="margin:0 0 6px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        You're a third of the way through, ${first} 📊
      </p>
      <p style="margin:0 0 22px;font-size:15px;color:#475569;line-height:1.65;">
        Ten days into your free GasCap™ Pro trial — nice work. You still have 20 days to
        explore everything, and here are the features our power users swear by once they
        really dig in.
      </p>

      <table cellpadding="0" cellspacing="0" width="100%"
             style="background:#f8fafc;border-radius:12px;padding:4px 16px;margin-bottom:24px;">
        ${featureRow('🧠', 'AI trip planner', 'Plug in any origin, destination, and vehicle — get fuel cost, stops, and the cheapest stations en route.')}
        ${featureRow('📉', 'MPG drop detection', 'GasCap™ flags when your efficiency drops more than 10% — often the first sign of tire pressure, air filter, or fuel injector issues.')}
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
          fixed it in five minutes. GasCap™ just paid for itself for a year."</strong> — Marcus J., Orlando
        </p>
      </div>

      <!-- ── Referral callout ── -->
      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:12px;padding:18px 22px;margin:0 0 22px;">
        <p style="margin:0 0 6px;font-size:14px;font-weight:900;color:#92400e;">
          🔗 Earn Pro for free — refer a friend
        </p>
        <p style="margin:0 0 14px;font-size:13px;color:#78350f;line-height:1.6;">
          Every GasCap™ account includes a personal referral link inside the
          <strong>🔗 Share</strong> tab. Share it with a friend — when they
          upgrade to a paid plan, we automatically bank
          <strong>1 free Pro month</strong> for you. Refer enough friends and
          you can unlock <strong>lifetime Pro access</strong> — no subscription needed ever again.
        </p>
        <a href="${BASE_URL}/#share" style="display:inline-block;background:#f59e0b;color:#fff;font-weight:900;
           font-size:13px;padding:10px 22px;border-radius:10px;text-decoration:none;">
          📤 Get My Referral Link →
        </a>
      </div>

      <p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.65;">
        Twenty days still to go on your trial — use them. And if you love what you see,
        you can lock in Pro permanently starting at <strong>$4.99/month</strong> (or
        <strong>$49/year — 2 months free</strong>).
      </p>

      ${ctaButton('Open GasCap™ →', BASE_URL)}
      &nbsp;
      <a href="${BASE_URL}/upgrade" style="display:inline-block;background:#fff;color:#1e2d4a;border:2px solid #1e2d4a;font-weight:900;
         font-size:15px;padding:12px 28px;border-radius:12px;text-decoration:none;margin-top:4px;">
        See plans
      </a>

      <p style="margin:26px 0 0;font-size:12px;color:#94a3b8;line-height:1.6;">
        Reminder: your trial auto-reverts to the free plan on day 30. No card on file, no surprise charges.
      </p>
      <p style="margin:10px 0 0;font-size:13px;color:#475569;">
        — The GasCap™ Team
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const proUpsellEmailText = (name: string) =>
  `Hi ${name.split(' ')[0]}, you're 10 days into your GasCap™ Pro trial — 20 days left. Power-user features to try: AI trip planner, MPG drop detection, cost-per-mile tracking, unlimited badges, PDF reports. BONUS: Share your referral link (in the Share tab) — earn a free Pro month every time a friend upgrades, plus bonus drawing entries. Refer 15 and Pro is yours for life. Open the app: ${BASE_URL}`;

// ── Email 4 — 9 Days Left + Annual Deal (Day 21) ──────────────────────────

export function annualDealEmailHtml(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header('trial')}
    <tr><td style="padding:32px;">
      ${trialBadge(9)}

      <p style="margin:0 0 6px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        9 days left — lock in Pro before it expires ⏰
      </p>
      <p style="margin:0 0 22px;font-size:15px;color:#475569;line-height:1.65;">
        ${first}, your free GasCap™ Pro trial wraps up in nine days.
        If GasCap™ has earned a spot on your phone, this is the moment to lock it in
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

      <!-- ── Referral first-month-free callout ── -->
      <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;padding:18px 22px;margin:0 0 22px;">
        <p style="margin:0 0 6px;font-size:14px;font-weight:900;color:#075985;">
          💡 Want your first month of Pro for free?
        </p>
        <p style="margin:0 0 14px;font-size:13px;color:#0c4a6e;line-height:1.6;">
          You still have 9 days on your trial. Share your personal referral link right now —
          the moment a friend creates their free GasCap™ account, we bank
          <strong>1 free Pro month</strong> for you. Upgrade after that and
          your first month is <strong>on us</strong>. Find your link in the
          <strong>🔗 Share</strong> tab.
        </p>
        <a href="${BASE_URL}/#share" style="display:inline-block;background:#0284c7;color:#fff;font-weight:900;
           font-size:13px;padding:10px 22px;border-radius:10px;text-decoration:none;">
          🔗 Share My Referral Link →
        </a>
      </div>

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
        Prefer monthly? <a href="${BASE_URL}/upgrade" style="color:#f59e0b;font-weight:700;">GasCap™ Pro Monthly is $4.99/mo</a> —
        no contract, cancel anytime.
      </p>

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;margin-top:24px;">
        <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#15803d;">🚐 Multiple vehicles or a family?</p>
        <p style="margin:0;font-size:13px;color:#166534;line-height:1.5;">
          <strong>GasCap™ Fleet ($199/yr)</strong> covers unlimited vehicles, shared garage access,
          and per-vehicle spending breakdowns — ideal for households with 3+ cars or small business fleets.
          <a href="${BASE_URL}/upgrade" style="color:#16a34a;font-weight:700;">See Fleet →</a>
        </p>
      </div>

      <p style="margin:22px 0 0;font-size:12px;color:#94a3b8;line-height:1.6;">
        Your trial still has 9 days. If you don't upgrade, we'll automatically move you to the free plan — no charges, nothing to cancel.
      </p>
      <p style="margin:10px 0 0;font-size:13px;color:#475569;">
        — The GasCap™ Team
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const annualDealEmailText = (name: string) =>
  `Hi ${name.split(' ')[0]}, your free GasCap™ Pro trial ends in 9 days. Quick tip: share your referral link now (in the Share tab) — if a friend signs up, we bank 1 free Pro month for you, making your first month $0. Lock in Pro Annual at $49/yr (just $4.08/mo — 2 months free) or monthly at $4.99. Upgrade: ${BASE_URL}/upgrade`;

// ── Email 5 — Final 48 Hours (Day 28) ─────────────────────────────────────

export function lastCallEmailHtml(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header('trial')}
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
        ${featureRow('🤖', 'GasCap™ AI Fuel Advisor', 'Unlimited questions about fuel, MPG, trips, and maintenance.')}
        ${featureRow('📊', 'Full MPG + spending charts', 'Trends, history, and predictive alerts across every vehicle.')}
        ${featureRow('🎯', 'Budget + overspend alerts', 'Know when you\'re about to blow your fuel budget before it happens.')}
        ${featureRow('🔧', 'Maintenance reminders', 'Oil change, tire rotation, and service intervals — never forget one.')}
        ${featureRow('🚗', 'Your Garage — up to 3 vehicles', 'Save every car you drive. Switch between them in one tap.')}
        ${featureRow('📄', 'Monthly PDF fuel reports', 'Expense-report ready in one tap.')}
      </table>

      <p style="margin:0 0 14px;font-size:14px;color:#475569;line-height:1.65;">
        <strong>Not upgrading?</strong> That's completely okay. Your GasCap™ free account will still have
        the calculators, live gas price lookup, and one saved vehicle — yours forever, no charge. We'd
        just love to hear why so we can keep making GasCap™ better. Just hit reply.
      </p>

      <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Thanks for giving GasCap™ a real shot, ${first}. Whatever you decide, we're glad you're here. 🙌
      </p>
      <p style="margin:8px 0 0;font-size:13px;color:#475569;">
        — Don, Founder of GasCap™
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const lastCallEmailText = (name: string) =>
  `Hi ${name.split(' ')[0]}, your GasCap™ Pro trial ends in 48 hours. Lock in Pro Annual at $49/yr ($4.08/mo) before your account reverts to free. Upgrade: ${BASE_URL}/upgrade`;

// ── Email 6 — Trial Ended (fires from expiry cron on downgrade) ────────────

export function trialEndedEmailHtml(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header()}
    <tr><td style="padding:32px;">
      <p style="margin:0 0 6px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        Your Pro trial has ended, ${first}
      </p>
      <p style="margin:0 0 22px;font-size:15px;color:#475569;line-height:1.65;">
        Your 30-day GasCap™ Pro trial wrapped up today. Your account is now on the
        free plan — your data, vehicles, and fill-up history are all still there,
        nothing was lost.
      </p>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;
                  padding:20px 24px;margin-bottom:24px;">
        <p style="margin:0 0 12px;font-size:13px;font-weight:800;color:#1e2d4a;
                  text-transform:uppercase;letter-spacing:0.5px;">
          What you had on Pro — still available if you upgrade
        </p>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${featureRow('📊', 'MPG drop detection', 'Automatic alerts when your fuel economy slips')}
          ${featureRow('🤖', 'AI Trip Advisor', 'Smart fill-up timing and route cost estimates')}
          ${featureRow('📄', 'PDF export', 'Full fill-up history for taxes or reimbursements')}
          ${featureRow('🏅', 'Unlimited badges & streaks', 'All milestones, no cap')}
          ${featureRow('📍', 'Unlimited vehicles', 'Track your whole household or small fleet')}
          ${featureRow('🎁', 'Referral rewards', 'Earn free months — refer 15 and Pro is free for life')}
        </table>
      </div>

      <div style="text-align:center;background:linear-gradient(135deg,#fefce8,#fef3c7);
                  border:2px solid #fde68a;border-radius:16px;padding:24px;margin-bottom:24px;">
        <p style="margin:0 0 4px;font-size:22px;font-weight:900;color:#92400e;">
          Still want Pro?
        </p>
        <p style="margin:0 0 16px;font-size:14px;color:#92400e;">
          <strong>$4.99/mo</strong> or save 2 months with <strong>$49/yr</strong>
        </p>
        ${ctaButton('Upgrade to Pro →', `${BASE_URL}/upgrade`)}
        <p style="margin:14px 0 0;font-size:12px;color:#b45309;">
          No commitment on monthly. Cancel anytime.
        </p>
      </div>

      <p style="margin:0 0 14px;font-size:14px;color:#475569;line-height:1.65;">
        Staying on the free plan? No problem at all. You'll keep unlimited
        fuel calculations, live gas price lookup, and one saved vehicle — free, forever.
      </p>
      <p style="margin:0 0 14px;font-size:14px;color:#475569;line-height:1.65;">
        If there's anything we could have done better during your trial, just
        hit reply — we read every message personally.
      </p>
      <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;">
        Thanks for trying GasCap™, ${first}. We hope to see you back on Pro soon. 🙌
      </p>
      <p style="margin:8px 0 0;font-size:13px;color:#475569;">
        — Don, Founder of GasCap™
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const trialEndedEmailText = (name: string) =>
  `Hi ${name.split(' ')[0]}, your GasCap™ Pro trial has ended and your account is now on the free plan. Your data is safe. Want to keep Pro? Upgrade at ${BASE_URL}/upgrade — $4.99/mo or $49/yr. Free plan keeps unlimited calculations, gas price lookup, and one vehicle. — Don, GasCap™`;

// ── Campaign dispatch helper ───────────────────────────────────────────────

export interface CampaignRecipient {
  id:        string;
  name:      string;
  email:     string;
  verifyUrl?: string;  // passed on step-1 so the welcome email can include a verification reminder
}

export async function sendCampaignEmail(step: number, user: CampaignRecipient): Promise<void> {
  const { id, name, email, verifyUrl } = user;

  const MAP: Record<number, { subject: string; html: string; text: string }> = {
    1: {
      subject: "Welcome to GasCap™ — your free Pro trial is live 🎉",
      html:    welcomeEmailHtml(name, id, verifyUrl),
      text:    welcomeEmailText(name),
    },
    2: {
      subject: '4 Pro features worth trying this week ⚡',
      html:    featureTipsEmailHtml(name, id),
      text:    featureTipsEmailText(name),
    },
    3: {
      subject: "10 days in — here are the features GasCap™ power users love 📊",
      html:    proUpsellEmailHtml(name, id),
      text:    proUpsellEmailText(name),
    },
    4: {
      subject: '9 days left on your Pro trial — lock in the best price ⏰',
      html:    annualDealEmailHtml(name, id),
      text:    annualDealEmailText(name),
    },
    5: {
      subject: 'Your GasCap™ Pro trial ends in 48 hours 🚨',
      html:    lastCallEmailHtml(name, id),
      text:    lastCallEmailText(name),
    },
  };

  const mail = MAP[step];
  if (!mail) throw new Error(`Unknown campaign step: ${step}`);
  await sendMail({ to: email, ...mail });
  logEmail({ userId: id, userEmail: email, userName: name, type: `trial-d${step}`, subject: mail.subject }).catch(() => {});
}

// ── Referral credit earned notification ───────────────────────────────────────
// Sent to the referrer when a referred user makes their first real payment.

export function referralCreditEmailHtml(
  referrerName: string,
  referrerId:   string,
  totalCredits: number,
): string {
  const first    = referrerName.split(' ')[0];
  const creditWord = totalCredits === 1 ? 'credit' : 'credits';
  const settingsUrl = `${BASE_URL}/settings`;

  return wrap(`
    ${header()}
    <tr><td style="padding:32px;">

      <p style="margin:0 0 8px;font-size:28px;font-weight:900;color:#1e2d4a;line-height:1.15;">
        You earned a free month! 🎉
      </p>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">
        Good news, ${first} — someone you referred just became a paying GasCap™ subscriber.
        That means <strong>1 free month of GasCap™ Pro</strong> has been added to your account.
      </p>

      <!-- Credit balance pill -->
      <div style="background:#fef3c7;border:1.5px solid #fcd34d;border-radius:14px;
                  padding:20px 24px;margin:0 0 24px;text-align:center;">
        <p style="margin:0 0 4px;font-size:36px;font-weight:900;color:#d97706;">${totalCredits}</p>
        <p style="margin:0;font-size:13px;font-weight:700;color:#92400e;text-transform:uppercase;
                  letter-spacing:0.5px;">
          free month${totalCredits === 1 ? '' : 's'} banked
        </p>
      </div>

      <!-- How it works -->
      <div style="background:#f8fafc;border-radius:12px;padding:20px 24px;margin:0 0 24px;">
        <p style="margin:0 0 12px;font-size:12px;font-weight:900;color:#1e2d4a;
                  letter-spacing:0.8px;text-transform:uppercase;">
          ℹ️ How your ${creditWord} work
        </p>
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="padding:6px 0;vertical-align:top;width:20px;color:#f59e0b;font-size:14px;font-weight:900;">✓</td>
            <td style="padding:6px 0 6px 10px;font-size:13px;color:#475569;line-height:1.5;">
              Each credit = 1 free month of GasCap™ Pro ($4.99 value)
            </td>
          </tr>
          <tr>
            <td style="padding:6px 0;vertical-align:top;width:20px;color:#f59e0b;font-size:14px;font-weight:900;">✓</td>
            <td style="padding:6px 0 6px 10px;font-size:13px;color:#475569;line-height:1.5;">
              Credits apply automatically on your next billing cycle
              (up to 3 at a time — you can bank more for later)
            </td>
          </tr>
          <tr>
            <td style="padding:6px 0;vertical-align:top;width:20px;color:#f59e0b;font-size:14px;font-weight:900;">✓</td>
            <td style="padding:6px 0 6px 10px;font-size:13px;color:#475569;line-height:1.5;">
              Credits are earned when your referral subscribes to a paid GasCap™ plan —
              free trial sign-ups that never pay <strong>do not count</strong>
            </td>
          </tr>
          <tr>
            <td style="padding:6px 0;vertical-align:top;width:20px;color:#dc2626;font-size:14px;font-weight:900;">!</td>
            <td style="padding:6px 0 6px 10px;font-size:13px;color:#475569;line-height:1.5;">
              Credits expire after 12 months if unused — redeem them before they expire!
            </td>
          </tr>
        </table>
      </div>

      <p style="margin:0 0 20px;font-size:14px;color:#64748b;line-height:1.6;">
        Keep sharing your referral link to earn more free months. You can earn up to
        <strong>6 free months</strong> total — and at 15 paying referrals, Pro is yours for life.
      </p>

      <div style="text-align:center;">
        ${ctaButton('View My Credits →', settingsUrl)}
      </div>

    </td></tr>
    ${footer(referrerId)}
  `);
}

export function referralCreditEmailText(
  referrerName: string,
  totalCredits: number,
): string {
  const first = referrerName.split(' ')[0];
  return `Hi ${first}, someone you referred just became a paying GasCap™ subscriber! You've earned 1 free month of Pro. You now have ${totalCredits} credit${totalCredits === 1 ? '' : 's'} banked (each = 1 free month, $4.99 value). Credits apply on your next billing cycle (up to 3 at once) and expire after 12 months. You can earn up to 6 free months total — at 15 paying referrals, Pro is yours for life. View your credits: ${BASE_URL}/settings`;
}

export async function sendReferralCreditEmail(
  referrerId:   string,
  referrerEmail: string,
  referrerName:  string,
  totalCredits:  number,
): Promise<void> {
  const subject = `🎉 You earned a free month on GasCap™! (${totalCredits} banked)`;
  await sendMail({
    to:      referrerEmail,
    subject,
    html:    referralCreditEmailHtml(referrerName, referrerId, totalCredits),
    text:    referralCreditEmailText(referrerName, totalCredits),
  });
  logEmail({ userId: referrerId, userEmail: referrerEmail, userName: referrerName, type: 'referral-credit', subject }).catch(() => {});
}

// ── Complimentary Pro for Life ─────────────────────────────────────────────────

export function compProForLifeEmailHtml(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header('comp')}
    <tr><td style="padding:32px;">
      <div style="display:inline-block;background:#005F4A;color:#fff;font-weight:900;
                  font-size:11px;padding:6px 14px;border-radius:20px;letter-spacing:0.5px;
                  text-transform:uppercase;margin-bottom:16px;">
        🎁 Complimentary Pro — No Subscription Required
      </div>

      <h1 style="margin:0 0 10px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        You&apos;ve got GasCap™ Pro — on us. Forever.
      </h1>

      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">
        Hi ${first}, we&apos;ve set up your GasCap™ account with complimentary Pro access —
        no subscription needed, no expiry date, no credit card. Your account is Pro for life.
      </p>

      <p style="margin:0 0 18px;font-size:14px;color:#475569;line-height:1.65;">
        Here&apos;s everything that&apos;s now unlocked on your account:
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        ${featureRow('⛽', 'Smart Fill-Up Calculator', 'Know exactly how many gallons to pump and what it will cost — before you pull up.')}
        ${featureRow('📊', 'MPG Tracking & Charts', 'Log every fill-up and watch your fuel efficiency trend over time. Spot drops before they become expensive.')}
        ${featureRow('💰', 'Monthly Budget Tracker', 'See your real fuel spend per month, compare to previous months, and set a target.')}
        ${featureRow('🚗', 'Rental Car Return Mode', 'Avoid the $12/gal refuel trap — calculate exactly how much to pump before returning any rental.')}
        ${featureRow('🤖', 'AI Fuel Advisor', 'Ask anything about fuel costs, routes, or savings — personalized to your vehicle and fill-up history.')}
        ${featureRow('🏆', 'Monthly Gas Card Giveaway', 'You&apos;re automatically entered every month you&apos;re active. No extra steps.')}
        ${featureRow('🔗', 'Referral Program', 'Share your link — earn credits and help unlock lifetime Pro access for yourself.')}
      </table>

      ${ctaButton('Open GasCap™ Now →', BASE_URL)}

      <p style="margin:28px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Questions? Just reply to this email — we&apos;re a small team and we read everything.
      </p>
      <p style="margin:10px 0 0;font-size:13px;color:#475569;">
        — The GasCap™ Team
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const compProForLifeEmailText = (name: string): string =>
  `Hi ${name.split(' ')[0]}, great news — your GasCap™ account has been set up with complimentary Pro access. No subscription, no expiry, no credit card required. Your account is Pro for life. Sign in to explore all your Pro features at ${BASE_URL}. Questions? Just reply to this email. — The GasCap™ Team`;

export async function sendCompProForLifeEmail(
  userId:    string,
  userEmail: string,
  userName:  string,
): Promise<void> {
  const subject = `🎁 Your GasCap™ Pro access — complimentary, forever`;
  await sendMail({
    to:      userEmail,
    subject,
    html:    compProForLifeEmailHtml(userName, userId),
    text:    compProForLifeEmailText(userName),
  });
  logEmail({ userId, userEmail, userName, type: 'comp-pro-for-life', subject }).catch(() => {});
}

// ── Comp Ambassador Drip — C2–C5 ──────────────────────────────────────────────
// These emails go only to ambassadorProForLife=true users, managed by the
// comp-campaign cron. C1 is the comp welcome email above (sent immediately).

/** Dark teal badge for comp ambassador emails */
function compBadge() {
  return `
    <div style="display:inline-block;background:#005F4A;color:#fff;font-weight:900;
                font-size:11px;padding:6px 14px;border-radius:20px;letter-spacing:0.5px;
                text-transform:uppercase;margin-bottom:16px;">
      🎁 GasCap™ Ambassador — Exclusive
    </div>`;
}

/** Teal CTA button variant for comp emails */
function compCtaButton(label: string, url: string) {
  return `
    <a href="${url}" style="display:inline-block;background:#005F4A;color:#fff;font-weight:900;
       font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none;margin-top:4px;">
      ${label}
    </a>`;
}

/** Reward milestone row for the milestone breakdown email */
function milestoneRow(count: string, reward: string, desc: string, reached: boolean) {
  const bg = reached ? '#ecfdf5' : '#f8fafc';
  const border = reached ? '#6ee7b7' : '#e2e8f0';
  return `
    <tr>
      <td style="padding:10px 12px;border-radius:10px;background:${bg};border:1px solid ${border};margin-bottom:8px;display:block;">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="background:#005F4A;color:#fff;font-size:11px;font-weight:900;
                      padding:4px 10px;border-radius:20px;white-space:nowrap;">${count}</div>
          <div>
            <p style="margin:0;font-size:14px;font-weight:900;color:#1e2d4a;">${reward}</p>
            <p style="margin:0;font-size:12px;color:#64748b;">${desc}</p>
          </div>
          ${reached ? '<div style="margin-left:auto;color:#059669;font-size:18px;">✓</div>' : ''}
        </div>
      </td>
    </tr>
    <tr><td style="padding:4px;"></td></tr>`;
}

// ── C2 — Day 3: Share mechanics walkthrough ────────────────────────────────

export function compC2EmailHtml(name: string, userId: string): string {
  const first = name.split(' ')[0];
  const referralUrl = `${BASE_URL}/#share`;
  return wrap(`
    ${header('comp')}
    <tr><td style="padding:32px;">
      ${compBadge()}

      <p style="margin:0 0 6px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        Here's how to share GasCap™, ${first} 🔗
      </p>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">
        Your personal referral link is ready — and sharing it is simpler than you think.
        Here's a quick walkthrough so you can start earning toward your Visa prepaid card rewards.
      </p>

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:22px;margin-bottom:24px;">
        <p style="margin:0 0 14px;font-size:12px;font-weight:900;color:#166534;letter-spacing:1px;text-transform:uppercase;">
          ⚡ 3 steps to share
        </p>
        <table cellpadding="0" cellspacing="0" width="100%">
          ${featureRow('1️⃣', 'Open GasCap™ → Share tab', 'Tap the Share icon at the bottom of the app. Your unique referral link and QR code are right there.')}
          ${featureRow('2️⃣', 'Copy your link or grab your QR code', 'Paste the link in a text, group chat, or social caption — or screenshot the QR code for in-person sharing.')}
          ${featureRow('3️⃣', 'When they upgrade, you earn', 'Every time someone you referred upgrades to a paid plan, you earn credit toward your Visa prepaid card milestones.')}
        </table>
      </div>

      <div style="background:#1e2d4a;border-radius:14px;padding:20px;margin-bottom:24px;">
        <p style="margin:0 0 8px;font-size:13px;font-weight:900;color:#fbbf24;letter-spacing:0.5px;text-transform:uppercase;">
          📋 Copy-paste ready messages
        </p>
        <div style="background:rgba(255,255,255,.08);border-radius:10px;padding:14px;margin-bottom:10px;">
          <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Text message</p>
          <p style="margin:0;font-size:13px;color:#fff;line-height:1.6;font-style:italic;">
            "Hey — try this app called GasCap™. It tells you exactly how many gallons to pump so you never overpay. Free to use: [YOUR LINK]"
          </p>
        </div>
        <div style="background:rgba(255,255,255,.08);border-radius:10px;padding:14px;">
          <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Group chat or social post</p>
          <p style="margin:0;font-size:13px;color:#fff;line-height:1.6;font-style:italic;">
            "Anyone else tired of guessing at the gas pump? I've been using GasCap™ — it calculates exactly what to pump before you pull up. Free app: [YOUR LINK]"
          </p>
        </div>
      </div>

      <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.65;">
        <strong>Pro tip:</strong> The QR code is your secret weapon for in-person sharing —
        at gas stations, break rooms, parking lots. Anyone can scan it without typing a thing.
      </p>

      ${compCtaButton('Get Your Referral Link + QR Code →', referralUrl)}

      <p style="margin:28px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Questions? Just reply — we read every message.
      </p>
      <p style="margin:8px 0 0;font-size:13px;color:#475569;">— The GasCap™ Team</p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const compC2EmailText = (name: string): string => {
  const first = name.split(' ')[0];
  return `Hi ${first}, your GasCap™ referral link is ready. Here's how to share it in 3 steps: (1) Open GasCap™ and go to the Share tab. (2) Copy your link or save your QR code. (3) Paste it in a text, group chat, or social caption — when someone you referred upgrades, you earn toward your Visa prepaid card rewards. Copy-paste text: "Hey — try this app called GasCap™. It tells you exactly how many gallons to pump so you never overpay. Free to use: [YOUR LINK]". Get your link at ${BASE_URL}/#share`;
};

// ── C3 — Day 7: Best places to share ──────────────────────────────────────

export function compC3EmailHtml(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header('comp')}
    <tr><td style="padding:32px;">
      ${compBadge()}

      <p style="margin:0 0 6px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        The best places to share GasCap™, ${first} 📋
      </p>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">
        Not sure where to start? Here are the highest-conversion spots our top ambassadors use —
        plus ready-to-send messages for each one.
      </p>

      <table cellpadding="0" cellspacing="0" width="100%">
        ${featureRow('💬', 'Group chats (WhatsApp, iMessage, Telegram)', 'Groups of 10–30 people are the sweet spot. One message reaches everyone who drives. Use the casual script from C2.')}
        ${featureRow('🏘️', 'Facebook groups (local community, gas price alerts, commuters)', 'Search your city + "gas prices" or "driving" on Facebook. Post your referral link in the first comment — not the post body — to avoid algorithm suppression.')}
        ${featureRow('👷', 'Work break room or team chat (Slack, Teams)', '"Anyone else dealing with gas prices this week? I found this…" — professional setting, high trust.')}
        ${featureRow('⛽', 'In person at the gas station', 'Show someone the QR code while you\'re both filling up. The context is perfect and the conversion rate is high.')}
        ${featureRow('📱', 'Your Instagram or Facebook story', 'Screenshot the app in action, add your referral link in the bio, tell people to check the link in your bio.')}
      </table>

      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:12px;padding:18px 22px;margin:20px 0 24px;">
        <p style="margin:0 0 6px;font-size:14px;font-weight:900;color:#92400e;">
          🎯 The script that works everywhere
        </p>
        <p style="margin:0;font-size:14px;color:#78350f;line-height:1.65;font-style:italic;">
          "Do you ever guess at the pump and end up paying too much? This app called GasCap™ tells you exactly how many gallons you need — based on your tank size and current price. It's free. Here's the link: [YOUR LINK]"
        </p>
      </div>

      <p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.65;">
        <strong>Remember:</strong> You earn Visa prepaid card credits only when someone you referred
        upgrades to a paid plan. So the more people you reach, the faster your rewards stack up.
      </p>

      ${compCtaButton('Open GasCap™ + Share Tab →', `${BASE_URL}/#share`)}

      <p style="margin:28px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Reply anytime — we love hearing what's working for our ambassadors.
      </p>
      <p style="margin:8px 0 0;font-size:13px;color:#475569;">— The GasCap™ Team</p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const compC3EmailText = (name: string): string => {
  const first = name.split(' ')[0];
  return `Hi ${first}, here are the best places to share GasCap™: (1) Group chats — WhatsApp, iMessage, Telegram. (2) Facebook groups — local community, gas price alerts, commuters. (3) Work break rooms or team chat. (4) In person at the gas station — show them your QR code. (5) Your Instagram or Facebook story. The script that works everywhere: "Do you ever guess at the pump and end up paying too much? This app called GasCap™ tells you exactly how many gallons you need. It's free: [YOUR LINK]". Share at ${BASE_URL}/#share`;
};

// ── C4 — Day 14: Milestone rewards breakdown ───────────────────────────────

export function compC4EmailHtml(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header('comp')}
    <tr><td style="padding:32px;">
      ${compBadge()}

      <p style="margin:0 0 6px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        Your Ambassador rewards, ${first} 🎁
      </p>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">
        Here's a full breakdown of what you unlock as you refer more people to GasCap™.
        Every paying referral counts — and they add up for life.
      </p>

      <div style="background:#1e2d4a;border-radius:14px;padding:22px;margin-bottom:24px;">
        <p style="margin:0 0 14px;font-size:12px;font-weight:900;color:#fbbf24;letter-spacing:1px;text-transform:uppercase;">
          🏆 Visa Prepaid Card Milestone Rewards
        </p>
        <table cellpadding="0" cellspacing="0" width="100%">
          ${milestoneRow('10 paying referrals', '$25 Visa Prepaid Card', 'We send you a $25 Visa prepaid card — use it anywhere Visa is accepted', false)}
          ${milestoneRow('25 paying referrals', '$50 Visa Prepaid Card', 'You\'ve helped 25 drivers save — here\'s $50 back', false)}
          ${milestoneRow('50 paying referrals', '$100 Visa Prepaid Card', 'Elite Ambassador status — you\'ve earned it', false)}
        </table>
        <p style="margin:12px 0 0;font-size:11px;color:rgba(255,255,255,.5);line-height:1.5;">
          Milestones are cumulative and permanent — they never reset. We'll reach out when you hit one.
        </p>
      </div>

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:20px;margin-bottom:24px;">
        <p style="margin:0 0 10px;font-size:13px;font-weight:900;color:#166534;">📊 How referrals are counted</p>
        <table cellpadding="0" cellspacing="0" width="100%">
          ${featureRow('✓', 'Someone signs up using your referral link', 'They appear in your referred list immediately')}
          ${featureRow('💳', 'They upgrade to a paid GasCap™ plan', 'This is when your referral count goes up — free signups don\'t count toward milestones')}
          ${featureRow('📈', 'Your count only goes up — never resets', 'Even if they later cancel, your milestone count stays')}
        </table>
      </div>

      <p style="margin:0 0 6px;font-size:14px;font-weight:900;color:#1e2d4a;">
        📬 How to claim
      </p>
      <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.65;">
        We monitor ambassador referral counts and will reach out by email when you cross a milestone.
        No need to do anything — just keep sharing and we'll take care of the rest.
      </p>

      ${compCtaButton('Check Your Referral Count →', `${BASE_URL}/#share`)}

      <p style="margin:28px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Questions about your rewards? Just reply to this email.
      </p>
      <p style="margin:8px 0 0;font-size:13px;color:#475569;">— The GasCap™ Team</p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const compC4EmailText = (name: string): string => {
  const first = name.split(' ')[0];
  return `Hi ${first}, here's your Ambassador rewards breakdown: 10 paying referrals → $25 Visa prepaid card. 25 paying referrals → $50 Visa prepaid card. 50 paying referrals → $100 Visa prepaid card. Milestones are cumulative and permanent — they never reset. We'll reach out when you hit one. Referrals count only when someone you referred upgrades to a paid plan. Check your count at ${BASE_URL}/#share. Questions? Just reply to this email.`;
};

// ── C5 — Day 30: Re-engagement + top ambassador tips ──────────────────────

export function compC5EmailHtml(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header('comp')}
    <tr><td style="padding:32px;">
      ${compBadge()}

      <p style="margin:0 0 6px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        One month in, ${first} — thank you 🏆
      </p>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">
        You've been a GasCap™ Ambassador for 30 days. Whether you've shared once or a dozen times,
        your support is genuinely helping us grow — and we don't take that lightly.
      </p>

      <div style="background:#1e2d4a;border-radius:14px;padding:22px;margin-bottom:24px;">
        <p style="margin:0 0 14px;font-size:12px;font-weight:900;color:#fbbf24;letter-spacing:1px;text-transform:uppercase;">
          💡 What's working for our top ambassadors
        </p>
        <table cellpadding="0" cellspacing="0" width="100%">
          ${featureRow('🗣️', 'Personal recommendation beats everything', 'A direct message to one person who drives a lot converts better than posting to 1,000 followers. Be specific — "I know you commute 40 miles each way, you\'ll love this."')}
          ${featureRow('📸', 'Show, don\'t just tell', 'Screenshot the calculator mid-use with a real price and tank size. Seeing the output ("pump exactly 8.2 gallons") is more convincing than any description.')}
          ${featureRow('🔄', 'Re-share when gas prices spike', 'Gas price headlines are your cue. People are most receptive to fuel-saving tools when prices are in the news.')}
          ${featureRow('💬', 'Reply to questions you get', 'If someone asks "does it really work?" — answer them personally. That one conversation can unlock a cascade of referrals.')}
        </table>
      </div>

      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:12px;padding:18px 22px;margin-bottom:24px;">
        <p style="margin:0 0 8px;font-size:14px;font-weight:900;color:#92400e;">
          🎁 Your Visa prepaid card milestones — a quick recap
        </p>
        <p style="margin:0;font-size:14px;color:#78350f;line-height:1.65;">
          10 paying referrals → <strong>$25 Visa prepaid card</strong><br>
          25 paying referrals → <strong>$50 Visa prepaid card</strong><br>
          50 paying referrals → <strong>$100 Visa prepaid card</strong><br>
          <span style="font-size:12px;color:#92400e;opacity:.8;">Cumulative and permanent — milestones never reset</span>
        </p>
      </div>

      <p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.65;">
        <strong>We're here to help you succeed.</strong> If there's anything we can do to make sharing easier —
        better graphics, a custom message template, anything — just reply to this email and ask.
        We build fast.
      </p>

      ${compCtaButton('Open GasCap™ + Share Tab →', `${BASE_URL}/#share`)}

      <p style="margin:28px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Thank you again for being part of this from the beginning.
      </p>
      <p style="margin:8px 0 0;font-size:13px;color:#475569;">— Don & the GasCap™ Team</p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const compC5EmailText = (name: string): string => {
  const first = name.split(' ')[0];
  return `Hi ${first}, you've been a GasCap™ Ambassador for 30 days — thank you. Tips from our top ambassadors: (1) Personal recommendation beats mass posting. (2) Show the calculator mid-use in a screenshot. (3) Re-share when gas prices spike in the news. (4) Reply personally to questions. Visa prepaid card milestone recap: 10 referrals → $25, 25 referrals → $50, 50 referrals → $100. Milestones are cumulative and permanent. Want help with better graphics or message templates? Just reply to this email. Open GasCap™ at ${BASE_URL}/#share`;
};

// ── Early-Upgrade Offer — one-time announcement to active trial users ─────────

export function earlyUpgradeOfferEmailHtml(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header('trial')}
    <tr><td style="padding:32px;">

      <div style="display:inline-block;background:#0d9488;color:#fff;font-weight:900;
                  font-size:11px;padding:6px 14px;border-radius:20px;letter-spacing:0.5px;
                  text-transform:uppercase;margin-bottom:16px;">
        🎰 Special offer for Pro trial members
      </div>

      <p style="margin:0 0 8px;font-size:26px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        Upgrade before your trial ends → +10 bonus draw entries/month
      </p>

      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">
        Hi ${first} — we're adding a new perk for members who upgrade while their free
        Pro trial is still active. <strong>Upgrade to Pro or Fleet before your 30-day
        trial expires</strong> and you'll earn <strong>+10 bonus giveaway entries</strong>
        every single month you stay subscribed. Not a one-time thing — every month,
        on top of everything you already earn.
      </p>

      <!-- What is the giveaway? -->
      <div style="background:#f8fafc;border-radius:14px;padding:20px 24px;margin-bottom:24px;border-left:4px solid #0d9488;">
        <p style="margin:0 0 8px;font-size:14px;font-weight:900;color:#1e2d4a;">🎁 The monthly GasCap™ Gas Card Giveaway</p>
        <p style="margin:0;font-size:13px;color:#475569;line-height:1.6;">
          Every month we draw a winner from the pool of active Pro and Fleet members.
          Your entries are earned from days you use the app, your login streak, and now —
          for early upgraders — a permanent +10 bonus on top. The more entries you have,
          the better your odds.
        </p>
      </div>

      <!-- Breakdown example -->
      <div style="background:#1e2d4a;border-radius:14px;padding:22px;margin-bottom:24px;">
        <p style="margin:0 0 14px;font-size:12px;font-weight:900;color:#fbbf24;letter-spacing:1px;text-transform:uppercase;">
          📊 Example entry breakdown for a typical month
        </p>
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.1);font-size:13px;color:rgba(255,255,255,.8);">15 active days in the month</td>
            <td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.1);font-size:13px;font-weight:900;color:#fff;text-align:right;">+15 entries</td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.1);font-size:13px;color:rgba(255,255,255,.8);">7-day login streak bonus</td>
            <td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.1);font-size:13px;font-weight:900;color:#fff;text-align:right;">+2 entries</td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-size:13px;font-weight:900;color:#fbbf24;">🎰 Early-upgrade bonus (yours forever)</td>
            <td style="padding:8px 0;font-size:13px;font-weight:900;color:#fbbf24;text-align:right;">+10 entries</td>
          </tr>
          <tr>
            <td colspan="2" style="padding:12px 0 0;border-top:1px solid rgba(255,255,255,.2);">
              <p style="margin:0;font-size:15px;font-weight:900;color:#fff;">Total: <strong>27 entries</strong> that month</p>
            </td>
          </tr>
        </table>
        <p style="margin:12px 0 0;font-size:11px;color:rgba(255,255,255,.5);line-height:1.5;">
          Without the early-upgrade bonus: only 17 entries. The bonus stacks every month you stay subscribed.
        </p>
      </div>

      <!-- How it works -->
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:18px 22px;margin-bottom:24px;">
        <p style="margin:0 0 8px;font-size:13px;font-weight:900;color:#166534;">How it works</p>
        <table cellpadding="0" cellspacing="0" width="100%">
          ${featureRow('✓', 'Upgrade during your free trial', 'Must be active on a Pro trial when you complete your first payment.')}
          ${featureRow('🎰', '+10 entries added to your account', 'Credited immediately — shown in your giveaway entries dashboard.')}
          ${featureRow('🔄', 'Bonus applies every month, automatically', 'No action needed. As long as your subscription is active, the bonus counts.')}
          ${featureRow('🚫', 'Bonus is tied to your subscription', 'If you cancel and rejoin, the bonus doesn\'t carry over. Keep the streak going.')}
        </table>
      </div>

      <div style="text-align:center;">
        ${ctaButton('Claim Your Bonus → Upgrade Now', `${BASE_URL}/upgrade`)}
      </div>

      <p style="margin:22px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Your trial is still running — this offer is available until it expires. Upgrade now
        to lock in the bonus before the trial clock runs out.
      </p>
      <p style="margin:10px 0 0;font-size:13px;color:#475569;">
        — Don, Founder of GasCap™
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

export const earlyUpgradeOfferEmailText = (name: string): string => {
  const first = name.split(' ')[0];
  return `Hi ${first}, we have a special offer for Pro trial members: upgrade to Pro or Fleet before your 30-day trial expires and earn +10 bonus draw entries into the monthly GasCap™ gas card giveaway — every month you stay subscribed. Example: 15 active days (15 entries) + 7-day streak bonus (2 entries) + early-upgrade bonus (10 entries) = 27 total entries that month. The bonus stacks automatically each month as long as your subscription is active. Upgrade now: ${BASE_URL}/upgrade`;
};

// ── Comp Campaign dispatcher ───────────────────────────────────────────────

/** Send the appropriate comp ambassador drip email for a given step (2–5). */
export async function sendCompCampaignEmail(
  step:  number,
  user:  { id: string; name: string; email: string },
): Promise<void> {
  let subject: string;
  let html:    string;
  let text:    string;

  switch (step) {
    case 2:
      subject = '🔗 Here\'s how to share GasCap™ — your link + QR code';
      html    = compC2EmailHtml(user.name, user.id);
      text    = compC2EmailText(user.name);
      break;
    case 3:
      subject = '📋 The best places to share GasCap™ (copy-paste scripts inside)';
      html    = compC3EmailHtml(user.name, user.id);
      text    = compC3EmailText(user.name);
      break;
    case 4:
      subject = '🎁 Your GasCap™ Ambassador milestone rewards';
      html    = compC4EmailHtml(user.name, user.id);
      text    = compC4EmailText(user.name);
      break;
    case 5:
      subject = '🏆 One month in — tips from our top ambassadors';
      html    = compC5EmailHtml(user.name, user.id);
      text    = compC5EmailText(user.name);
      break;
    default:
      throw new Error(`[compCampaign] Unknown step ${step}`);
  }

  await sendMail({ to: user.email, subject, html, text });
  logEmail({ userId: user.id, userEmail: user.email, userName: user.name, type: `comp-c${step}`, subject }).catch(() => {});
}
