/**
 * Engagement drip — Pro solo (S1–S5) and Fleet (F1–F4) tracks.
 * Fires after upgrade to keep paying subscribers engaged, reduce churn,
 * deepen feature usage, and drive referrals.
 *
 * Pro track:   S1 day 45 · S2 day 75 · S3 day 105 · S4 day 165 · S5 day 335 (annual)
 * Fleet track: F1 day 14 · F2 day 45 · F3 day 105 · F4 day 180
 *
 * Milestone emails (behavior-triggered, one-time):
 *   M1 — 10 fill-ups logged
 *   M2 — First MPG data point
 *   M3 — First referral signup
 */
import { sendMail, brandHeader } from './email';
import { logEmail }              from './emailLog';

const BASE_URL = process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? 'https://www.gascap.app';

function unsubLink(userId: string) {
  return `${BASE_URL}/api/email/unsubscribe?id=${userId}`;
}

function header(track: 'pro' | 'fleet') { return brandHeader(track); }

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

function fleetCtaButton(label: string, url: string) {
  return `
    <a href="${url}" style="display:inline-block;background:#005F4A;color:#fff;font-weight:900;
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

function proBadge() {
  return `<div style="display:inline-block;background:#005F4A;color:#fff;font-weight:900;
                font-size:11px;padding:6px 14px;border-radius:20px;letter-spacing:0.5px;
                text-transform:uppercase;margin-bottom:16px;">⭐ Pro Member</div>`;
}

function fleetBadge() {
  return `<div style="display:inline-block;background:#1e2d4a;color:#fff;font-weight:900;
                font-size:11px;padding:6px 14px;border-radius:20px;letter-spacing:0.5px;
                text-transform:uppercase;margin-bottom:16px;">🚗 Fleet Member</div>`;
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
</html>`;
}

// ── PRO TRACK ──────────────────────────────────────────────────────────────────

/** S1 — Day 45: "One month of real data — here's what it means" */
export function engS1EmailHtml(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header('pro')}
    <tr><td style="padding:32px;">
      ${proBadge()}
      <h1 style="margin:0 0 10px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        One month of real data — here's what it means
      </h1>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">
        Hi ${first}, you've been tracking your fill-ups for about a month now. That's enough data to
        start seeing patterns most drivers never notice — and to put real dollars back in your pocket.
      </p>

      <p style="margin:0 0 14px;font-size:14px;font-weight:700;color:#1e2d4a;">
        Three things to check in your app right now:
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        ${featureRow('📊', 'Your MPG trend chart', 'Open the Charts tab. If you\'ve added odometer readings, you\'ll see your fuel efficiency over time. A sudden dip often means a tune-up is overdue — catching it early saves real money.')}
        ${featureRow('🤖', 'Ask the AI Fuel Advisor', 'Tap the AI tab and ask: "Based on my fill-up history, what\'s costing me the most?" It reads your actual data and gives you a personalized answer.')}
        ${featureRow('🔔', 'Set a gas price alert', 'Go to Settings → Gas Price Alert and enter your target price. When the national average drops below it, you\'ll get notified so you can fill up at the right time.')}
      </table>

      ${ctaButton('Open GasCap™ →', BASE_URL)}

      <p style="margin:28px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Questions? Just reply — we read every email.
      </p>
      <p style="margin:10px 0 0;font-size:13px;color:#475569;">
        — The GasCap™ Team
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

/** S2 — Day 75: "The fill-up habit that saves drivers $300/year" */
export function engS2EmailHtml(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header('pro')}
    <tr><td style="padding:32px;">
      ${proBadge()}
      <h1 style="margin:0 0 10px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        The fill-up habit that separates fuel-savvy drivers
      </h1>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">
        Hi ${first}, one habit makes the biggest difference in what you actually save at the pump:
        logging your odometer reading every time you fill up. Here's why it matters — and what it unlocks.
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        ${featureRow('🛣️', 'Odometer = real MPG', 'Without a mileage reading, GasCap estimates your efficiency. With it, you get exact numbers — and a chart that shows whether your car is getting more or less efficient over time.')}
        ${featureRow('⚡️', 'Your streak keeps you honest', 'The streak counter at the top of the app tracks consecutive active weeks. Drivers with streaks over 30 days log fill-ups 3× more consistently — and save more as a result.')}
        ${featureRow('📋', 'Monthly report card', 'Every month, your Pro dashboard generates a report: total spend, average price paid per gallon, best and worst weeks. It\'s the kind of data your mechanic doesn\'t have — but you do.')}
      </table>

      <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.65;">
        The average GasCap™ Pro user who logs consistently saves <strong style="color:#1e2d4a;">$240–$320/year</strong> compared to drivers who guess at the pump. The data is already in your pocket — it just needs to be used.
      </p>

      ${ctaButton('Log a fill-up now →', `${BASE_URL}/?tab=log`)}

      <p style="margin:28px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Questions? Just reply — we read every email.
      </p>
      <p style="margin:10px 0 0;font-size:13px;color:#475569;">
        — The GasCap™ Team
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

/** S3 — Day 105: "Know anyone else who's tired of guessing at the pump?" */
export function engS3EmailHtml(name: string, userId: string, referralUrl?: string): string {
  const first   = name.split(' ')[0];
  const refUrl  = referralUrl ?? `${BASE_URL}/?tab=share`;
  return wrap(`
    ${header('pro')}
    <tr><td style="padding:32px;">
      ${proBadge()}
      <h1 style="margin:0 0 10px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        Know anyone else who's tired of guessing at the pump?
      </h1>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">
        Hi ${first}, you've been with GasCap™ for a few months now — you know the value. Here's how
        sharing it pays you back directly.
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        ${featureRow('🔗', 'Share your unique link', 'Every GasCap™ Pro member gets a personal referral link. When someone signs up through yours, you both benefit immediately.')}
        ${featureRow('💳', 'Earn free Pro months', 'Each verified referral earns you 1 free month of Pro — credited automatically, no code needed.')}
        ${featureRow('🏆', 'Unlock lifetime Pro', 'Refer 25 paying subscribers and your Pro access becomes permanent — no subscription, no renewal, ever.')}
        ${featureRow('🎯', 'Extra giveaway entries', 'Each active referral also boosts your monthly gas card giveaway entries. More referrals = more chances to win.')}
      </table>

      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0;font-size:14px;font-weight:700;color:#92400e;">Your referral link is in the Share tab →</p>
        <p style="margin:4px 0 0;font-size:13px;color:#b45309;line-height:1.5;">
          Open the app, tap Share, and copy your personal link. Takes 10 seconds. One text to a friend could earn you a free month.
        </p>
      </div>

      ${ctaButton('Go to my Share tab →', refUrl)}

      <p style="margin:28px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Questions? Just reply — we read every email.
      </p>
      <p style="margin:10px 0 0;font-size:13px;color:#475569;">
        — The GasCap™ Team
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

/** S4 — Day 165: "6 months in — you're officially a fuel nerd 🏆" */
export function engS4EmailHtml(name: string, userId: string, isMonthly = true): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header('pro')}
    <tr><td style="padding:32px;">
      ${proBadge()}
      <h1 style="margin:0 0 10px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        6 months in — you're officially a fuel nerd 🏆
      </h1>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">
        Hi ${first}, six months with GasCap™. That's easily 15–20 fill-ups tracked, real MPG data
        in hand, and a clearer picture of where your fuel money actually goes. Not many drivers
        can say that.
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        ${featureRow('🎯', 'Monthly gas card giveaway', 'As a Pro member you\'re automatically entered every month you\'re active — no extra steps. Active days and referrals increase your entries. Check your entry count in the app.')}
        ${featureRow('🤖', 'AI Fuel Advisor tip', 'Try asking: "What\'s my average cost per mile this year?" or "When should I expect to need a fill-up based on my history?" It gets smarter the more data you have.')}
        ${featureRow('🔗', 'Referrals add up fast', '6 months in, you likely know a few drivers who could use this. Each verified referral earns you a free Pro month and boosts your giveaway entries.')}
      </table>

      ${isMonthly ? `
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0;font-size:14px;font-weight:700;color:#166534;">Save 17% — switch to annual</p>
        <p style="margin:4px 0 0;font-size:13px;color:#15803d;line-height:1.5;">
          At $49/year, annual Pro works out to just $4.08/month — less than a single gallon of gas.
          Switch anytime in Settings → Plan.
        </p>
      </div>` : ''}

      ${ctaButton('Open GasCap™ →', BASE_URL)}

      <p style="margin:28px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Questions? Just reply — we read every email.
      </p>
      <p style="margin:10px 0 0;font-size:13px;color:#475569;">
        — The GasCap™ Team
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

/** S5 — Day 335: Annual renewal prep (annual subscribers only) */
export function engS5EmailHtml(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header('pro')}
    <tr><td style="padding:32px;">
      ${proBadge()}
      <h1 style="margin:0 0 10px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        Your year with GasCap™ — renewal is coming up
      </h1>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">
        Hi ${first}, your annual GasCap™ Pro subscription renews in about 30 days at $49 — that's
        $4.08/month for a full year of smarter fueling. Here's what that year looked like.
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        ${featureRow('⛽', 'Fill-ups tracked', 'Every gallon logged is a decision made with data instead of a guess. That adds up to real savings over 12 months.')}
        ${featureRow('📊', 'MPG trends', 'Your efficiency chart shows exactly how your vehicle performed across seasons, fuel blends, and driving patterns.')}
        ${featureRow('💰', 'Money not wasted', 'Drivers who track consistently with GasCap™ report saving an average of $240–$320/year compared to guessing at the pump.')}
        ${featureRow('🏆', 'Giveaway entries earned', 'Every active day earned you entries into the monthly gas card drawing — that\'s a perk of simply showing up.')}
      </table>

      <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.65;">
        Your renewal is automatic — no action needed. If you ever want to manage your subscription,
        visit <a href="${BASE_URL}/settings" style="color:#f59e0b;">Settings → Plan</a>.
      </p>

      ${ctaButton('Open GasCap™ →', BASE_URL)}

      <p style="margin:28px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Thank you for a great year. Questions? Just reply — we read everything.
      </p>
      <p style="margin:10px 0 0;font-size:13px;color:#475569;">
        — The GasCap™ Team
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

// ── FLEET TRACK ──────────────────────────────────────────────────────────────

/** F1 — Day 14: Fleet quick-start checklist */
export function engF1EmailHtml(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header('fleet')}
    <tr><td style="padding:32px;">
      ${fleetBadge()}
      <h1 style="margin:0 0 10px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        Your fleet setup checklist — get the most from day one
      </h1>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">
        Hi ${first}, you've had GasCap™ Fleet for about two weeks. Here's a quick checklist to make
        sure you're capturing the full value — especially the stuff most fleet owners miss at first.
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        ${featureRow('👥', 'Add your drivers to the roster', 'Go to Settings → Fleet → Driver Roster. Adding driver names lets you attribute each fill-up to the right person — critical for tracking who\'s spending what.')}
        ${featureRow('🚗', 'Add all vehicles', 'Each vehicle gets its own profile in the Garage tab. Logging fill-ups per vehicle gives you cost-per-vehicle breakdowns and flags anomalies like a sudden MPG drop.')}
        ${featureRow('📋', 'Assign fill-ups to drivers', 'When logging a fill-up, tap "Driver" to assign it. This is the foundation of your driver attribution reports and tax deduction tracking.')}
        ${featureRow('📊', 'Check the Fleet dashboard', 'The Fleet tab shows spend by vehicle, by driver, and by week. It\'s the view your accountant will want at tax time.')}
      </table>

      ${fleetCtaButton('Open Fleet Dashboard →', BASE_URL)}

      <p style="margin:28px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Need help setting anything up? Just reply — we're a small team and we prioritize fleet customers.
      </p>
      <p style="margin:10px 0 0;font-size:13px;color:#475569;">
        — The GasCap™ Team
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

/** F2 — Day 45: "Your first tax report is ready to run" */
export function engF2EmailHtml(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header('fleet')}
    <tr><td style="padding:32px;">
      ${fleetBadge()}
      <h1 style="margin:0 0 10px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        Your first tax report is ready to run
      </h1>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">
        Hi ${first}, if you've been logging fill-ups for your fleet for the past month, you now have
        enough data to run your first business fuel tax report. Here's why that matters — and how to do it.
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        ${featureRow('📄', 'Run a tax report', 'Go to Fleet → Tax Report. Select your date range and export a CSV. It lists every fill-up by driver, vehicle, date, gallons, and total cost — ready for your accountant or Schedule C.')}
        ${featureRow('💼', 'Business deduction tracking', 'Fuel used for business purposes is deductible. GasCap\'s fleet reports make it simple to separate business from personal fuel spend.')}
        ${featureRow('💰', 'Cost per driver, per vehicle', 'The fleet dashboard breaks down spend by driver and vehicle so you can spot outliers — a driver using more fuel than expected is often a route or behavior issue.')}
        ${featureRow('📊', 'Real ROI', 'Fleet owners using GasCap typically identify 8–15% in recoverable fuel waste within the first 90 days. The report gives you the data to act on it.')}
      </table>

      ${fleetCtaButton('Run my first tax report →', `${BASE_URL}/?tab=fleet`)}

      <p style="margin:28px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Questions about the report format or deduction rules? Just reply — happy to help.
      </p>
      <p style="margin:10px 0 0;font-size:13px;color:#475569;">
        — The GasCap™ Team
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

/** F3 — Day 105: "Know another fleet owner? They'll thank you." */
export function engF3EmailHtml(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header('fleet')}
    <tr><td style="padding:32px;">
      ${fleetBadge()}
      <h1 style="margin:0 0 10px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        Know another fleet owner? They'll thank you.
      </h1>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">
        Hi ${first}, after 3+ months of fleet tracking, you know what this saves — in time, in fuel
        waste, and at tax time. If you know other small business owners running vehicles, sharing
        GasCap™ is genuinely useful to them.
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        ${featureRow('🔗', 'Your referral link', 'Every account has a unique referral link in the Share tab. When a fleet owner signs up through yours, you earn credits toward your subscription.')}
        ${featureRow('💳', 'Earn free months', 'Each verified referral earns you 1 free month of Fleet — no limits on how many you can earn.')}
        ${featureRow('🏆', 'Path to lifetime access', 'Refer 25 paying subscribers and your access becomes permanent — no subscription, no renewal. Fleet owners with even a small network can get there fast.')}
      </table>

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0;font-size:14px;font-weight:700;color:#166534;">Who to share with:</p>
        <p style="margin:4px 0 0;font-size:13px;color:#15803d;line-height:1.5;">
          Other small business owners, tradespeople, delivery operators, real estate agents,
          contractors — anyone who tracks mileage or fuel for tax purposes. This tool pays for
          itself in the first deduction.
        </p>
      </div>

      ${fleetCtaButton('Go to my Share tab →', `${BASE_URL}/?tab=share`)}

      <p style="margin:28px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Questions? Just reply — we read every email.
      </p>
      <p style="margin:10px 0 0;font-size:13px;color:#475569;">
        — The GasCap™ Team
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

/** F4 — Day 180: "6 months, your whole fleet — here's your ROI" */
export function engF4EmailHtml(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${header('fleet')}
    <tr><td style="padding:32px;">
      ${fleetBadge()}
      <h1 style="margin:0 0 10px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        6 months, your whole fleet — here's your ROI
      </h1>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">
        Hi ${first}, six months of fleet tracking gives you something most small business owners
        don't have: a clear, documented picture of what your vehicles actually cost to run.
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        ${featureRow('📊', 'Run your 6-month report', 'Fleet → Tax Report → set date range to your start date. Export the full CSV — every fill-up, every driver, every vehicle, every dollar.')}
        ${featureRow('🔍', 'Look for these patterns', 'Vehicles with declining MPG often need maintenance before it becomes costly. Drivers with high per-mile fuel costs may be idling, speeding, or taking inefficient routes.')}
        ${featureRow('💼', 'Half-year tax deduction ready', 'If you\'re tracking business fuel, your mid-year export gives your accountant exactly what they need for estimated tax payments or quarterly reviews.')}
        ${featureRow('🚗', 'Add more vehicles anytime', 'Fleet grows with your business. Add vehicles in the Garage tab — each one gets its own history, MPG trend, and cost breakdown from day one.')}
      </table>

      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0;font-size:14px;font-weight:700;color:#92400e;">Renewal note</p>
        <p style="margin:4px 0 0;font-size:13px;color:#b45309;line-height:1.5;">
          Your Fleet subscription continues automatically. To manage billing, visit
          <a href="${BASE_URL}/settings" style="color:#d97706;">Settings → Plan</a>.
          Questions about your plan? Just reply.
        </p>
      </div>

      ${fleetCtaButton('Open Fleet Dashboard →', BASE_URL)}

      <p style="margin:28px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Thank you for 6 months. We're building more fleet features — reply to this email with anything you wish GasCap™ could do for your business.
      </p>
      <p style="margin:10px 0 0;font-size:13px;color:#475569;">
        — The GasCap™ Team
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

// ── MILESTONE EMAILS ──────────────────────────────────────────────────────────

/** M1 — 10 fill-ups logged (any plan) */
export function milestoneM1EmailHtml(name: string, userId: string, plan: string = 'pro'): string {
  const first = name.split(' ')[0];
  const track = plan === 'fleet' ? 'fleet' : 'pro';
  return wrap(`
    ${header(track)}
    <tr><td style="padding:32px;">
      <div style="display:inline-block;background:#f59e0b;color:#fff;font-weight:900;
                  font-size:11px;padding:6px 14px;border-radius:20px;letter-spacing:0.5px;
                  text-transform:uppercase;margin-bottom:16px;">🎉 Milestone Unlocked</div>
      <h1 style="margin:0 0 10px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        10 fill-ups logged — you're building something real
      </h1>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">
        Hi ${first}, you've logged 10 fill-ups. That might not sound like much, but it means you now
        have a real fuel history — and a few things just got a lot more useful.
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        ${featureRow('📊', 'Your MPG trend is meaningful now', 'With 10+ fill-ups, the Charts tab shows a real trend line — not just a point. Open Charts and look for the MPG curve. Is it steady? Climbing? Dropping?')}
        ${featureRow('💰', 'Your cost-per-mile is accurate', 'The dashboard now has enough data to calculate your true cost per mile. Open the app and check your Fuel Savings card — it\'s now personalized to your actual driving.')}
        ${featureRow('🤖', 'AI Fuel Advisor gets smarter', 'More data means better answers. Ask the AI Advisor: "What\'s my average MPG this month compared to last?" — it now has enough history to answer accurately.')}
      </table>

      ${ctaButton('See my fuel history →', BASE_URL)}

      <p style="margin:28px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Keep logging — every fill-up makes the data more useful.
      </p>
      <p style="margin:10px 0 0;font-size:13px;color:#475569;">
        — The GasCap™ Team
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

/** M2 — First MPG data point */
export function milestoneM2EmailHtml(name: string, userId: string, plan: string = 'pro'): string {
  const first = name.split(' ')[0];
  const track = plan === 'fleet' ? 'fleet' : 'pro';
  return wrap(`
    ${header(track)}
    <tr><td style="padding:32px;">
      <div style="display:inline-block;background:#10b981;color:#fff;font-weight:900;
                  font-size:11px;padding:6px 14px;border-radius:20px;letter-spacing:0.5px;
                  text-transform:uppercase;margin-bottom:16px;">🛣️ MPG Unlocked</div>
      <h1 style="margin:0 0 10px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        Your MPG baseline is set — here's what to watch
      </h1>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">
        Hi ${first}, you've added your first odometer reading, which means GasCap™ can now calculate
        your real fuel efficiency — not an estimate. Your MPG chart is now live. Here's how to read it.
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        ${featureRow('📈', 'What "good" MPG looks like', 'Your baseline is your current average. A drop of 2+ MPG from your baseline often signals something: dirty air filter, low tire pressure, or a tune-up due. Catching it early is much cheaper than ignoring it.')}
        ${featureRow('🌡️', 'Seasonal changes are normal', 'MPG typically drops 5–15% in winter due to cold starts, heavier oil, and more idling. Your chart will show this pattern — it\'s not a problem, it\'s just data.')}
        ${featureRow('⚡️', 'Keep the streak going', 'The more consistently you log odometer readings, the more accurate your trend becomes. Add your mileage every time you fill up — it takes 5 seconds.')}
      </table>

      ${ctaButton('View my MPG chart →', BASE_URL)}

      <p style="margin:28px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Questions about what your MPG data means? Ask the AI Fuel Advisor — or just reply to this email.
      </p>
      <p style="margin:10px 0 0;font-size:13px;color:#475569;">
        — The GasCap™ Team
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

/** M3 — First referral signup */
export function milestoneM3EmailHtml(name: string, userId: string, plan: string = 'pro'): string {
  const first = name.split(' ')[0];
  const track = plan === 'fleet' ? 'fleet' : 'pro';
  return wrap(`
    ${header(track)}
    <tr><td style="padding:32px;">
      <div style="display:inline-block;background:#8b5cf6;color:#fff;font-weight:900;
                  font-size:11px;padding:6px 14px;border-radius:20px;letter-spacing:0.5px;
                  text-transform:uppercase;margin-bottom:16px;">🎉 First Referral!</div>
      <h1 style="margin:0 0 10px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        Someone used your link — and you just earned a free month
      </h1>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">
        Hi ${first}, your first referral just signed up through your link. A free Pro month has been
        credited to your account automatically — no code needed, no action required.
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        ${featureRow('💳', '1 free month credited', 'Your referral credit is applied to your next renewal. Keep sharing and you can stack credits up to 12 months ahead.')}
        ${featureRow('🏆', 'You\'re on the board', 'Your Ambassador leaderboard rank has moved. The milestone rewards: 5 referrals = 1 extra entry/day, 14 = 2 extra, 25 = Lifetime Pro forever.')}
        ${featureRow('🔗', 'Share again — it compounds', 'One referral is great. Five is a free year. Share your link again while the habit is fresh — text a friend, post it somewhere, or add it to your bio.')}
      </table>

      <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0;font-size:14px;font-weight:700;color:#5b21b6;">Your referral link is in the Share tab</p>
        <p style="margin:4px 0 0;font-size:13px;color:#7c3aed;line-height:1.5;">
          Open the app → Share tab → copy your link and share it anywhere. Each signup earns you another free month.
        </p>
      </div>

      ${ctaButton('Share my link →', `${BASE_URL}/?tab=share`)}

      <p style="margin:28px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
        Thank you for spreading the word. Questions? Just reply.
      </p>
      <p style="margin:10px 0 0;font-size:13px;color:#475569;">
        — The GasCap™ Team
      </p>
    </td></tr>
    ${footer(userId)}
  `);
}

// ── Send helpers ───────────────────────────────────────────────────────────────

interface EngUser { id: string; name: string; email: string; plan?: string; stripeInterval?: string; referralCode?: string; }

export async function sendEngagementEmail(
  step: number,
  track: 'pro' | 'fleet',
  user: EngUser,
): Promise<void> {
  const { id, name, email, stripeInterval } = user;
  const BASE = process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? 'https://www.gascap.app';
  const refUrl = user.referralCode ? `${BASE}/?ref=${user.referralCode}` : undefined;
  const isMonthly = stripeInterval !== 'annual';

  let subject = '';
  let html    = '';

  if (track === 'pro') {
    switch (step) {
      case 1: subject = 'One month of real data — here\'s what it means';         html = engS1EmailHtml(name, id); break;
      case 2: subject = 'The fill-up habit that separates fuel-savvy drivers';     html = engS2EmailHtml(name, id); break;
      case 3: subject = 'Know anyone else who\'s tired of guessing at the pump?';  html = engS3EmailHtml(name, id, refUrl); break;
      case 4: subject = '6 months in — you\'re officially a fuel nerd 🏆';        html = engS4EmailHtml(name, id, isMonthly); break;
      case 5: subject = 'Your year with GasCap™ — renewal is coming up';          html = engS5EmailHtml(name, id); break;
      default: throw new Error(`[engagement] Unknown pro step ${step}`);
    }
  } else {
    switch (step) {
      case 1: subject = 'Your fleet setup checklist — get the most from day one';  html = engF1EmailHtml(name, id); break;
      case 2: subject = 'Your first tax report is ready to run';                   html = engF2EmailHtml(name, id); break;
      case 3: subject = 'Know another fleet owner? They\'ll thank you.';           html = engF3EmailHtml(name, id); break;
      case 4: subject = '6 months, your whole fleet — here\'s your ROI';           html = engF4EmailHtml(name, id); break;
      default: throw new Error(`[engagement] Unknown fleet step ${step}`);
    }
  }

  await sendMail({ to: email, subject, html, unsubscribeUrl: unsubLink(id) });
  logEmail({ userId: id, userEmail: email, userName: name, type: `eng-${track === 'pro' ? 's' : 'f'}${step}`, subject }).catch(() => {});
}

export async function sendMilestoneEmail(
  milestone: 'fillup10' | 'mpg' | 'referral1',
  user: EngUser,
): Promise<void> {
  const { id, name, email, plan = 'pro' } = user;

  const configs = {
    fillup10:  { subject: 'You\'ve logged 10 fill-ups 🎉',                              html: milestoneM1EmailHtml(name, id, plan) },
    mpg:       { subject: 'Your MPG baseline is set — here\'s what to watch',           html: milestoneM2EmailHtml(name, id, plan) },
    referral1: { subject: 'Someone used your link — you just earned a free month 🎉',   html: milestoneM3EmailHtml(name, id, plan) },
  };

  const { subject, html } = configs[milestone];
  await sendMail({ to: email, subject, html, unsubscribeUrl: unsubLink(id) });
  logEmail({ userId: id, userEmail: email, userName: name, type: `milestone-${milestone}`, subject }).catch(() => {});
}
