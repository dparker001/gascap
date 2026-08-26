/**
 * Phase 5C — Feedback Campaign invitation/reminder emails.
 *
 * Deliberately NOT review/rating solicitation — see CLAUDE.md's sweepstakes
 * section and the Phase 5C business-message instructions: this asks for
 * product feedback (likes/dislikes/confusion/bugs/requests), never an App
 * Store or Google review. The $50 Feedback Drawing is mentioned as an
 * incentive, subordinate to the feedback ask itself; the $9.99 Lifetime
 * thank-you offer is deliberately NOT the headline — only a restrained
 * one-line teaser, per instruction, revealed in full only after submission.
 *
 * Locale-aware (EN/ES) via lib/translations.ts's feedbackCampaignEmail
 * section — unlike the other lifecycle email families in this codebase
 * (trial drip, paid drip), which are English-only by longstanding
 * convention. This one is localized because Phase 5C explicitly requires it.
 */
import { brandHeader } from './email';
import type { Locale } from './translations';
import { getTranslations } from './translations';

const BASE_URL = process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? 'https://www.gascap.app';

function unsubLink(userId: string) {
  return `${BASE_URL}/api/email/unsubscribe?id=${userId}`;
}

function footer(userId: string) {
  return `
    <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;border-radius:0 0 16px 16px;">
      <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.6;text-align:center;">
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

function ctaButton(label: string, url: string) {
  return `
    <a href="${url}" style="display:inline-block;background:#f59e0b;color:#fff;font-weight:900;
       font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none;margin-top:4px;">
      ${label}
    </a>`;
}

/** e.g. "September 30" — always in the campaign's own timezone, never the reader's device zone. */
export function formatCampaignDeadline(endsAt: Date, timezone: string, locale: Locale): string {
  return endsAt.toLocaleDateString(locale === 'es' ? 'es-US' : 'en-US', {
    month: 'long', day: 'numeric', timeZone: timezone,
  });
}

export function feedbackInviteEmailHtml(
  name: string, userId: string, deadlineLabel: string, locale: Locale, source: 'email' = 'email',
): string {
  const t = getTranslations(locale).feedbackCampaignEmail;
  const first = name.split(' ')[0];
  const surveyUrl = `${BASE_URL}/feedback?source=${source}`;
  return wrap(`
    ${brandHeader()}
    <tr><td style="padding:32px;">
      <p style="margin:0 0 6px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        ${t.inviteHeading(first)}
      </p>
      <p style="margin:0 0 10px;font-size:15px;color:#475569;line-height:1.65;">
        ${t.inviteBody1}
      </p>
      <p style="margin:0 0 22px;font-size:15px;color:#475569;line-height:1.65;">
        ${t.inviteBody2}
      </p>

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;margin:0 0 16px;">
        <p style="margin:0;font-size:13px;color:#166534;line-height:1.6;">
          🎁 ${t.inviteDrawingLine(deadlineLabel)}
        </p>
      </div>

      <p style="margin:0 0 24px;font-size:12px;color:#94a3b8;line-height:1.6;">
        ${t.inviteThankYouLine}
      </p>

      ${ctaButton(t.inviteCta, surveyUrl)}
    </td></tr>
    ${footer(userId)}
  `);
}

export function feedbackInviteEmailText(name: string, deadlineLabel: string, locale: Locale, source: 'email' = 'email'): string {
  const t = getTranslations(locale).feedbackCampaignEmail;
  const first = name.split(' ')[0];
  return `${t.inviteHeading(first)} ${t.inviteBody1} ${t.inviteBody2} ${t.inviteDrawingLine(deadlineLabel)} ${t.inviteThankYouLine} ${BASE_URL}/feedback?source=${source}`;
}

export function feedbackReminderEmailHtml(
  name: string, userId: string, deadlineLabel: string, locale: Locale, source: 'reminder' = 'reminder',
): string {
  const t = getTranslations(locale).feedbackCampaignEmail;
  const first = name.split(' ')[0];
  const surveyUrl = `${BASE_URL}/feedback?source=${source}`;
  return wrap(`
    ${brandHeader()}
    <tr><td style="padding:32px;">
      <p style="margin:0 0 6px;font-size:24px;font-weight:900;color:#1e2d4a;line-height:1.2;">
        ${t.reminderHeading}, ${first}
      </p>
      <p style="margin:0 0 22px;font-size:15px;color:#475569;line-height:1.65;">
        ${t.reminderBody}
      </p>

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;margin:0 0 24px;">
        <p style="margin:0;font-size:13px;color:#166534;line-height:1.6;">
          🎁 ${t.reminderDrawingLine(deadlineLabel)}
        </p>
      </div>

      ${ctaButton(t.reminderCta, surveyUrl)}
    </td></tr>
    ${footer(userId)}
  `);
}

export function feedbackReminderEmailText(name: string, deadlineLabel: string, locale: Locale, source: 'reminder' = 'reminder'): string {
  const t = getTranslations(locale).feedbackCampaignEmail;
  const first = name.split(' ')[0];
  return `${t.reminderHeading}, ${first}. ${t.reminderBody} ${t.reminderDrawingLine(deadlineLabel)} ${BASE_URL}/feedback?source=${source}`;
}
