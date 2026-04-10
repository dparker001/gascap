/**
 * Render the GasCap™ welcome drip email to a local HTML file for review.
 *
 * Run:  node scripts/preview-welcome-email.mjs
 * Outputs: /tmp/gascap-welcome-preview.html  (then opens in your default browser)
 *
 * This mirrors lib/emailCampaign.ts::welcomeEmailHtml exactly, so the preview
 * is byte-identical to what a new signup would receive. No emails are sent.
 */
import { writeFileSync } from 'node:fs';
import { execSync }      from 'node:child_process';

const name      = 'Don';
const firstName = name.split(' ')[0];
const BASE_URL  = 'https://www.gascap.app';
const fakeId    = 'preview_demo';

// ── Template helpers (mirrors lib/emailCampaign.ts) ────────────────────────

function brandHeader() {
  return `
        <tr><td style="background:#1e2d4a;padding:22px 32px;border-radius:16px 16px 0 0;">
          <table cellpadding="0" cellspacing="0" border="0" role="presentation"><tr><td
               style="background:#ffffff;padding:10px 16px;border-radius:10px;mso-padding-alt:10px 16px;">
            <span style="font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;
                         font-size:24px;font-weight:900;letter-spacing:-0.5px;line-height:1;
                         white-space:nowrap;">
              <span style="color:#15a680;">Gas</span><span style="color:#0a5240;">Cap</span><sup
                    style="color:#fa7109;font-size:11px;font-weight:900;vertical-align:super;line-height:0;">™</sup>
            </span>
          </td></tr></table>
        </td></tr>`;
}

function footer(userId) {
  return `
    <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;border-radius:0 0 16px 16px;">
      <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.6;">
        GasCap™ · Know before you go ·
        <a href="${BASE_URL}" style="color:#f59e0b;text-decoration:none;">gascap.app</a><br>
        <a href="${BASE_URL}/api/email/unsubscribe?id=${userId}" style="color:#cbd5e1;text-decoration:underline;">Unsubscribe</a> from GasCap marketing emails
      </p>
    </td></tr>`;
}

function ctaButton(label, url) {
  return `
    <a href="${url}" style="display:inline-block;background:#f59e0b;color:#fff;font-weight:900;
       font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none;margin-top:4px;">
      ${label}
    </a>`;
}

function trialBadge(daysLeft) {
  const color = daysLeft <= 5 ? '#dc2626' : daysLeft <= 10 ? '#d97706' : '#16a34a';
  return `
    <div style="display:inline-block;background:${color};color:#fff;font-weight:900;
                font-size:11px;padding:6px 12px;border-radius:20px;letter-spacing:0.5px;
                text-transform:uppercase;margin-bottom:14px;">
      ⭐ Pro trial · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left
    </div>`;
}

function wrap(body) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GasCap™ Welcome Email Preview</title></head>
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

function welcomeEmailHtml(first, userId) {
  return wrap(`
    ${brandHeader()}
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
            <td style="padding:6px 0;vertical-align:top;width:28px;font-size:16px;">🚗</td>
            <td style="padding:6px 0 6px 10px;vertical-align:top;color:#fff;">
              <p style="margin:0;font-size:13px;font-weight:700;">Rental Car Return Mode</p>
              <p style="margin:0;font-size:12px;color:rgba(255,255,255,.65);line-height:1.5;">Never overpay at return. Calculates the exact gallons to buy before dropping off.</p>
            </td>
          </tr>
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

// ── Write to disk & open ───────────────────────────────────────────────────

const out = '/tmp/gascap-welcome-preview.html';
writeFileSync(out, welcomeEmailHtml(firstName, fakeId));
console.log(`✓ Welcome email rendered to: ${out}`);

try {
  execSync(`open "${out}"`);
  console.log(`✓ Opened in your default browser.`);
} catch (e) {
  console.log(`(Could not auto-open — manually open: ${out})`);
}
