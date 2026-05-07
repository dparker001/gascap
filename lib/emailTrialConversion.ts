/**
 * Trial conversion email sequence — 3 emails sent as a burst
 * in the final week before Pro trials expire.
 *
 * C1 (May 19): "What you're getting" — soft value reminder
 * C2 (May 23): "The math" — savings proof, price anchoring
 * C3 (May 25): "48 hours left" — hard deadline, urgency
 *
 * Fired by /api/cron/trial-conversion on a date-gated GitHub Actions schedule.
 */
import { sendMail, brandHeader } from './email';
import { logEmail }              from './emailLog';

const BASE_URL = process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? 'https://www.gascap.app';

function unsubLink(userId: string) {
  return `${BASE_URL}/api/email/unsubscribe?id=${userId}`;
}

function ctaButton(label: string, url: string, bg = '#f59e0b') {
  return `
    <a href="${url}" style="display:inline-block;background:${bg};color:#fff;font-weight:900;
       font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none;margin-top:4px;">
      ${label}
    </a>`;
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

// ── C1: "What you're getting" — soft value reminder ──────────────────────────

export function conversionC1Html(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${brandHeader('trial')}
    <tr><td style="padding:32px;">

      <p style="margin:0 0 6px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        ${first}, here's what you've unlocked.
      </p>
      <p style="margin:0 0 22px;font-size:15px;color:#475569;line-height:1.6;">
        You've been on GasCap™ Pro for a few weeks now — which means you've had access to
        tools that most drivers don't even know exist. Here's a quick recap of what's been
        working in your favor.
      </p>

      <!-- Feature list -->
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:22px 24px;margin:0 0 22px;">
        <p style="margin:0 0 16px;font-size:13px;font-weight:800;color:#16a34a;text-transform:uppercase;letter-spacing:0.5px;">
          Your Pro Features — Active Now
        </p>
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="padding:8px 0;vertical-align:top;width:28px;font-size:18px;">⛽</td>
            <td style="padding:8px 0 8px 10px;vertical-align:top;">
              <p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#1e2d4a;">Exact Fill-Up Calculator</p>
              <p style="margin:0;font-size:13px;color:#64748b;line-height:1.5;">Know the exact gallon amount and dollar cost before you swipe — every time.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;vertical-align:top;font-size:18px;">🏆</td>
            <td style="padding:8px 0 8px 10px;vertical-align:top;">
              <p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#1e2d4a;">Monthly Gas Card Giveaway</p>
              <p style="margin:0;font-size:13px;color:#64748b;line-height:1.5;">You're automatically entered every month you're active. No extra steps required.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;vertical-align:top;font-size:18px;">📊</td>
            <td style="padding:8px 0 8px 10px;vertical-align:top;">
              <p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#1e2d4a;">MPG Trending Charts</p>
              <p style="margin:0;font-size:13px;color:#64748b;line-height:1.5;">Track your fuel efficiency over time — catch engine issues before they become expensive.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;vertical-align:top;font-size:18px;">🚗</td>
            <td style="padding:8px 0 8px 10px;vertical-align:top;">
              <p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#1e2d4a;">Rental Car Return Mode</p>
              <p style="margin:0;font-size:13px;color:#64748b;line-height:1.5;">Never get hit with the $12/gal rental refuel fee again. Pays for Pro in a single trip.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;vertical-align:top;font-size:18px;">🔥</td>
            <td style="padding:8px 0 8px 10px;vertical-align:top;">
              <p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#1e2d4a;">Login Streak & Bonus Entries</p>
              <p style="margin:0;font-size:13px;color:#64748b;line-height:1.5;">Your streak is building giveaway entries every day. Don't lose it when your trial ends.</p>
            </td>
          </tr>
        </table>
      </div>

      <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#1e2d4a;">
        Your trial ends at the end of the month.
      </p>
      <p style="margin:0 0 22px;font-size:15px;color:#475569;line-height:1.6;">
        When it does, your account drops to the free plan — and you'll lose access to
        the features above, your streak bonus entries, and your spot in the monthly draw.
        Pro is <strong>$4.99/month</strong> or <strong>$49/year</strong> (2 months free).
      </p>

      <div style="text-align:center;padding:22px 0 8px;">
        ${ctaButton('Keep My Pro Access →', `${BASE_URL}/upgrade`)}
        <p style="margin:14px 0 0;font-size:12px;color:#94a3b8;">Cancel anytime. No contracts.</p>
      </div>

    </td></tr>
    ${footer(userId)}
  `);
}

export function conversionC1Text(name: string): string {
  const first = name.split(' ')[0];
  return `Hi ${first}, your GasCap™ Pro trial is winding down — here's what you've had access to: exact fill-up calculator, monthly gas card giveaway entries, MPG trending charts, Rental Car Return Mode, and streak bonus entries. Your trial ends at the end of the month. When it does, you'll lose these features and your giveaway spot. Keep Pro at $4.99/mo or $49/yr: ${BASE_URL}/upgrade`;
}

// ── C2: "The math" — savings proof, price anchoring ──────────────────────────

export function conversionC2Html(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${brandHeader('trial')}
    <tr><td style="padding:32px;">

      <p style="margin:0 0 6px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        GasCap™ pays for itself in 2 fill-ups.
      </p>
      <p style="margin:0 0 22px;font-size:15px;color:#475569;line-height:1.6;">
        Here's the math most people never think about, ${first}.
      </p>

      <!-- Math callout -->
      <div style="background:#1e2d4a;border-radius:14px;padding:24px;margin:0 0 22px;">
        <p style="margin:0 0 16px;font-size:13px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">
          The Average Driver — Per Fill-Up
        </p>

        <div style="display:flex;margin:0 0 12px;">
          <div style="flex:1;background:rgba(255,255,255,0.07);border-radius:10px;padding:16px;margin-right:8px;">
            <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Guessing</p>
            <p style="margin:0;font-size:28px;font-weight:900;color:#ef4444;">$5–10</p>
            <p style="margin:4px 0 0;font-size:12px;color:#94a3b8;">overpaid on average</p>
          </div>
          <div style="flex:1;background:rgba(30,182,143,0.15);border:1px solid #1EB68F;border-radius:10px;padding:16px;margin-left:8px;">
            <p style="margin:0 0 4px;font-size:11px;color:#1EB68F;text-transform:uppercase;letter-spacing:0.5px;">With GasCap™</p>
            <p style="margin:0;font-size:28px;font-weight:900;color:#1EB68F;">$0</p>
            <p style="margin:4px 0 0;font-size:12px;color:#94a3b8;">you pump exactly what you need</p>
          </div>
        </div>

        <p style="margin:0;font-size:13px;color:#cbd5e1;line-height:1.6;">
          Guessing at the pump means either topping off beyond your tank's needs
          or stopping short and making an extra trip. GasCap™ eliminates both.
          At 2 fill-ups per week, the savings add up fast.
        </p>
      </div>

      <!-- Price anchor -->
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:14px;padding:22px 24px;margin:0 0 22px;">
        <p style="margin:0 0 12px;font-size:15px;font-weight:700;color:#92400e;">
          🎯 The price breakdown — put in perspective
        </p>
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="padding:6px 0;font-size:14px;color:#475569;">GasCap™ Pro Annual</td>
            <td style="padding:6px 0;font-size:14px;font-weight:700;color:#1e2d4a;text-align:right;">$49/year</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:14px;color:#475569;">That's per month</td>
            <td style="padding:6px 0;font-size:14px;font-weight:700;color:#1e2d4a;text-align:right;">$4.08/mo</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:14px;color:#475569;">That's per day</td>
            <td style="padding:6px 0;font-size:14px;font-weight:700;color:#1e2d4a;text-align:right;">$0.13/day</td>
          </tr>
          <tr>
            <td colspan="2" style="padding:12px 0 0;border-top:1px solid #fde68a;">
              <p style="margin:0;font-size:13px;color:#92400e;line-height:1.5;">
                Less than a pack of gum per day. If GasCap™ saves you even <strong>$5 on your next fill-up</strong>,
                it's already paid for itself — with 11 months of Pro left to go.
              </p>
            </td>
          </tr>
        </table>
      </div>

      <!-- Giveaway sweetener -->
      <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:14px;padding:18px 22px;margin:0 0 22px;">
        <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#0369a1;">🏆 And there's the giveaway...</p>
        <p style="margin:0;font-size:13px;color:#0369a1;line-height:1.5;">
          Every day you're active as a Pro member earns you entries into the monthly gas card draw.
          Your streak multiplies those entries. When your trial ends, your entries reset to zero.
          Staying Pro keeps you in — every single month.
        </p>
      </div>

      <div style="text-align:center;padding:18px 0 8px;">
        ${ctaButton('Upgrade to Pro — $49/yr →', `${BASE_URL}/upgrade`)}
        <p style="margin:12px 0 0;font-size:13px;color:#64748b;">
          Prefer monthly? <a href="${BASE_URL}/upgrade" style="color:#f59e0b;font-weight:700;">$4.99/mo</a> — cancel anytime.
        </p>
      </div>

    </td></tr>
    ${footer(userId)}
  `);
}

export function conversionC2Text(name: string): string {
  const first = name.split(' ')[0];
  return `Hi ${first}, here's the math: most drivers overpay $5–10 per fill-up by guessing. GasCap™ tells you exactly what to pump. At 2 fill-ups a week, that adds up fast. Pro costs $4.08/mo on the annual plan ($49/yr) — less than $0.13/day. If it saves you $5 on your next fill-up, it's already paid for itself. Plus: staying Pro keeps your giveaway entries active every month. Upgrade now: ${BASE_URL}/upgrade`;
}

// ── C3: "48 hours left" — hard deadline, urgency ─────────────────────────────

export function conversionC3Html(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${brandHeader('trial')}
    <tr><td style="padding:32px;">

      <!-- Urgency banner -->
      <div style="background:#dc2626;border-radius:12px;padding:14px 20px;margin:0 0 24px;text-align:center;">
        <p style="margin:0;font-size:14px;font-weight:900;color:#fff;letter-spacing:0.3px;">
          ⏰ Your GasCap™ Pro trial ends very soon
        </p>
      </div>

      <p style="margin:0 0 6px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        Don't lose what you've built, ${first}.
      </p>
      <p style="margin:0 0 22px;font-size:15px;color:#475569;line-height:1.6;">
        When your trial ends, here's exactly what goes away — unless you upgrade today.
      </p>

      <!-- Loss list -->
      <div style="border:2px solid #fca5a5;border-radius:14px;padding:20px 24px;margin:0 0 22px;background:#fff5f5;">
        <p style="margin:0 0 14px;font-size:13px;font-weight:800;color:#dc2626;text-transform:uppercase;letter-spacing:0.5px;">
          What you'll lose on the free plan
        </p>
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="padding:7px 0;vertical-align:top;width:22px;font-size:15px;color:#dc2626;">✗</td>
            <td style="padding:7px 0 7px 10px;font-size:14px;color:#475569;">Your <strong>login streak</strong> and all accumulated bonus giveaway entries</td>
          </tr>
          <tr>
            <td style="padding:7px 0;vertical-align:top;font-size:15px;color:#dc2626;">✗</td>
            <td style="padding:7px 0 7px 10px;font-size:14px;color:#475569;">Your spot in the <strong>monthly gas card giveaway</strong></td>
          </tr>
          <tr>
            <td style="padding:7px 0;vertical-align:top;font-size:15px;color:#dc2626;">✗</td>
            <td style="padding:7px 0 7px 10px;font-size:14px;color:#475569;"><strong>MPG trending charts</strong> and fuel efficiency history</td>
          </tr>
          <tr>
            <td style="padding:7px 0;vertical-align:top;font-size:15px;color:#dc2626;">✗</td>
            <td style="padding:7px 0 7px 10px;font-size:14px;color:#475569;"><strong>Rental Car Return Mode</strong> — the $12/gal fee trap is back</td>
          </tr>
          <tr>
            <td style="padding:7px 0;vertical-align:top;font-size:15px;color:#dc2626;">✗</td>
            <td style="padding:7px 0 7px 10px;font-size:14px;color:#475569;"><strong>Fill-up reminders</strong> and monthly budget tracker</td>
          </tr>
          <tr>
            <td style="padding:7px 0;vertical-align:top;font-size:15px;color:#dc2626;">✗</td>
            <td style="padding:7px 0 7px 10px;font-size:14px;color:#475569;"><strong>Unlimited vehicles</strong> in your garage</td>
          </tr>
        </table>
      </div>

      <!-- What stays -->
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:20px 24px;margin:0 0 22px;">
        <p style="margin:0 0 14px;font-size:13px;font-weight:800;color:#16a34a;text-transform:uppercase;letter-spacing:0.5px;">
          Lock it in today
        </p>
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #dcfce7;">
              <p style="margin:0;font-size:15px;font-weight:700;color:#1e2d4a;">GasCap™ Pro Annual</p>
              <p style="margin:2px 0 0;font-size:13px;color:#64748b;">$49/year — just $4.08/month. 2 months free vs monthly.</p>
            </td>
            <td style="padding:8px 0;border-bottom:1px solid #dcfce7;text-align:right;white-space:nowrap;">
              <span style="font-size:20px;font-weight:900;color:#16a34a;">$49/yr</span>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;">
              <p style="margin:0;font-size:15px;font-weight:700;color:#1e2d4a;">GasCap™ Pro Monthly</p>
              <p style="margin:2px 0 0;font-size:13px;color:#64748b;">$4.99/month — cancel anytime, no commitment.</p>
            </td>
            <td style="padding:8px 0;text-align:right;white-space:nowrap;">
              <span style="font-size:20px;font-weight:900;color:#1e2d4a;">$4.99/mo</span>
            </td>
          </tr>
        </table>
      </div>

      <div style="text-align:center;padding:18px 0 8px;">
        ${ctaButton('Upgrade Now — Keep My Pro →', `${BASE_URL}/upgrade`, '#dc2626')}
        <p style="margin:14px 0 0;font-size:12px;color:#94a3b8;">
          Questions? Reply to this email — we're happy to help.
        </p>
      </div>

    </td></tr>
    ${footer(userId)}
  `);
}

export function conversionC3Text(name: string): string {
  const first = name.split(' ')[0];
  return `Hi ${first}, your GasCap™ Pro trial ends very soon. When it does, you'll lose: your login streak and giveaway entries, your spot in the monthly gas card draw, MPG charts, Rental Car Return Mode, fill-up reminders, and unlimited garage vehicles. Keep Pro at $4.99/mo or $49/yr ($4.08/mo, 2 months free). Upgrade now before it expires: ${BASE_URL}/upgrade — reply to this email with any questions.`;
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

// ── C4: Special offer — $2.99/mo for first 3 months ─────────────────────────
// Sent May 26 to engaged trial users (calcCount ≥ 2 OR streak ≥ 3) only.
// Pre-applies Stripe coupon WELCOME299 via the upgrade URL.

const OFFER_URL = `${BASE_URL}/upgrade?coupon=WELCOME299`;

export function conversionC4Html(name: string, userId: string): string {
  const first = name.split(' ')[0];
  return wrap(`
    ${brandHeader('trial')}
    <tr><td style="padding:32px;">

      <!-- Special offer banner -->
      <div style="background:linear-gradient(135deg,#005F4A,#1EB68F);border-radius:14px;padding:22px 24px;margin:0 0 24px;text-align:center;">
        <p style="margin:0 0 4px;font-size:12px;font-weight:800;color:rgba(255,255,255,0.8);text-transform:uppercase;letter-spacing:1px;">
          Special Offer — 48 Hours Only
        </p>
        <p style="margin:0;font-size:32px;font-weight:900;color:#fff;line-height:1.1;">
          $2.99<span style="font-size:16px;font-weight:600;">/mo</span>
        </p>
        <p style="margin:6px 0 0;font-size:14px;color:rgba(255,255,255,0.85);">
          First 3 months · Then $4.99/mo · Cancel anytime
        </p>
      </div>

      <p style="margin:0 0 6px;font-size:22px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        ${first}, we'd like to keep you.
      </p>
      <p style="margin:0 0 22px;font-size:15px;color:#475569;line-height:1.6;">
        You've been one of our most active trial members — and we don't want to lose you
        over price. So here's a one-time offer, just for you:
      </p>

      <!-- Offer detail -->
      <div style="background:#f0fdf4;border:2px solid #16a34a;border-radius:14px;padding:22px 24px;margin:0 0 22px;">
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #dcfce7;">
              <p style="margin:0;font-size:15px;font-weight:700;color:#1e2d4a;">First 3 months</p>
              <p style="margin:2px 0 0;font-size:13px;color:#64748b;">Discounted introductory rate — auto-applied at checkout</p>
            </td>
            <td style="padding:8px 0;border-bottom:1px solid #dcfce7;text-align:right;white-space:nowrap;">
              <span style="font-size:22px;font-weight:900;color:#16a34a;">$2.99<span style="font-size:13px;">/mo</span></span>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;">
              <p style="margin:0;font-size:15px;font-weight:700;color:#1e2d4a;">After month 3</p>
              <p style="margin:2px 0 0;font-size:13px;color:#64748b;">Standard Pro rate — cancel anytime before then</p>
            </td>
            <td style="padding:8px 0;text-align:right;white-space:nowrap;">
              <span style="font-size:22px;font-weight:900;color:#1e2d4a;">$4.99<span style="font-size:13px;">/mo</span></span>
            </td>
          </tr>
        </table>
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid #dcfce7;">
          <p style="margin:0;font-size:13px;color:#16a34a;font-weight:700;">
            💰 You save $6.00 over the first 3 months vs. standard pricing.
          </p>
        </div>
      </div>

      <!-- What's included reminder -->
      <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#1e2d4a;">Everything you've been using, plus:</p>
      <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 22px;">
        <tr>
          <td style="padding:5px 0;vertical-align:top;width:22px;font-size:15px;color:#16a34a;">✓</td>
          <td style="padding:5px 0 5px 8px;font-size:14px;color:#475569;">Monthly gas card giveaway — entries keep building</td>
        </tr>
        <tr>
          <td style="padding:5px 0;vertical-align:top;font-size:15px;color:#16a34a;">✓</td>
          <td style="padding:5px 0 5px 8px;font-size:14px;color:#475569;">Your login streak and bonus entries preserved</td>
        </tr>
        <tr>
          <td style="padding:5px 0;vertical-align:top;font-size:15px;color:#16a34a;">✓</td>
          <td style="padding:5px 0 5px 8px;font-size:14px;color:#475569;">Rental Car Return Mode, MPG charts, fill-up reminders</td>
        </tr>
        <tr>
          <td style="padding:5px 0;vertical-align:top;font-size:15px;color:#16a34a;">✓</td>
          <td style="padding:5px 0 5px 8px;font-size:14px;color:#475569;">Discount auto-applied — no code needed at checkout</td>
        </tr>
      </table>

      <!-- Expiry -->
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px 18px;margin:0 0 22px;">
        <p style="margin:0;font-size:13px;color:#9a3412;font-weight:700;">
          ⏰ This offer expires in 48 hours — it will not be extended.
        </p>
      </div>

      <div style="text-align:center;padding:8px 0;">
        <a href="${OFFER_URL}" style="display:inline-block;background:#16a34a;color:#fff;font-weight:900;
           font-size:16px;padding:16px 36px;border-radius:12px;text-decoration:none;">
          Claim My $2.99 Offer →
        </a>
        <p style="margin:14px 0 0;font-size:12px;color:#94a3b8;">
          Discount auto-applied at checkout. No code needed. Cancel anytime.
        </p>
      </div>

    </td></tr>
    ${footer(userId)}
  `);
}

export function conversionC4Text(name: string): string {
  const first = name.split(' ')[0];
  return `Hi ${first}, we'd like to keep you as a GasCap™ Pro member. Here's a one-time offer just for you: $2.99/month for your first 3 months, then $4.99/month after that. That's $6 in savings, no code needed — the discount is applied automatically at checkout. This offer expires in 48 hours. Claim it here: ${OFFER_URL}`;
}

export interface ConversionRecipient {
  id:    string;
  name:  string;
  email: string;
}

interface ConversionMeta {
  subject:  string;
  preview:  string;
  htmlFn:   (name: string, userId: string) => string;
  textFn:   (name: string) => string;
  type:     string;
}

const CONVERSION_META: Record<number, ConversionMeta> = {
  1: {
    subject: "What GasCap™ Pro is doing for you — and what's next",
    preview: "A quick look at what you've unlocked this month.",
    htmlFn:  conversionC1Html,
    textFn:  conversionC1Text,
    type:    'trial-c1',
  },
  2: {
    subject: 'GasCap™ pays for itself in 2 fill-ups',
    preview: "Here's the math most people don't think about.",
    htmlFn:  conversionC2Html,
    textFn:  conversionC2Text,
    type:    'trial-c2',
  },
  3: {
    subject: 'Your GasCap™ Pro trial is ending — act now',
    preview: "Don't lose your streak, giveaway entries, and Pro features.",
    htmlFn:  conversionC3Html,
    textFn:  conversionC3Text,
    type:    'trial-c3',
  },
  4: {
    subject: "We'd like to keep you — here's a special offer",
    preview: '$2.99/month for your first 3 months. 48 hours only.',
    htmlFn:  conversionC4Html,
    textFn:  conversionC4Text,
    type:    'trial-c4',
  },
};

export async function sendConversionEmail(step: 1 | 2 | 3 | 4, user: ConversionRecipient): Promise<void> {
  const meta = CONVERSION_META[step];
  if (!meta) throw new Error(`Unknown conversion step: ${step}`);

  await sendMail({
    to:      user.email,
    subject: meta.subject,
    html:    meta.htmlFn(user.name, user.id),
    text:    meta.textFn(user.name),
    tags:    [
      { name: 'campaign', value: 'trial-conversion' },
      { name: 'step',     value: meta.type },          // e.g. trial-c1, trial-c2
    ],
  });

  await logEmail({
    userId:    user.id,
    userEmail: user.email,
    userName:  user.name,
    type:      meta.type,
    subject:   meta.subject,
  });
}
