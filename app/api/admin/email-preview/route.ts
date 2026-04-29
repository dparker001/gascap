/**
 * GET /api/admin/email-preview?template=<name>
 *
 * Returns the rendered HTML for a given email template.
 * Used by the admin panel to preview email content without sending.
 *
 * Protected by ADMIN_PASSWORD header (same auth as other admin routes).
 *
 * Templates available:
 *   trial-d1, trial-d2, trial-d3, trial-d4, trial-d5
 *   comp-c1, comp-c2, comp-c3, comp-c4, comp-c5
 *   paid-p1, paid-p2, paid-p3, paid-p5
 *   eng-s1, eng-s2, eng-s3, eng-s4, eng-s5  (Pro engagement drip)
 *   eng-f1, eng-f2, eng-f3, eng-f4           (Fleet engagement drip)
 *   eng-m1, eng-m2, eng-m3                   (Milestone emails)
 */
import { NextResponse } from 'next/server';
import {
  welcomeEmailHtml,
  featureTipsEmailHtml,
  proUpsellEmailHtml,
  annualDealEmailHtml,
  lastCallEmailHtml,
  compProForLifeEmailHtml,
  compC2EmailHtml,
  compC3EmailHtml,
  compC4EmailHtml,
  compC5EmailHtml,
} from '@/lib/emailCampaign';
import {
  upgradeConfirmEmailHtml,
  paidCheckInEmailHtml,
  paidSpotlightEmailHtml,
  cancellationEmailHtml,
} from '@/lib/emailCampaignPaid';
import {
  engS1EmailHtml,
  engS2EmailHtml,
  engS3EmailHtml,
  engS4EmailHtml,
  engS5EmailHtml,
  engF1EmailHtml,
  engF2EmailHtml,
  engF3EmailHtml,
  engF4EmailHtml,
  milestoneM1EmailHtml,
  milestoneM2EmailHtml,
  milestoneM3EmailHtml,
} from '@/lib/emailEngagement';

const PREVIEW_USER = {
  id:    'preview-user-id',
  name:  'Alex Preview',
  email: 'alex@example.com',
};

function auth(req: Request): boolean {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return false;
  return (req.headers.get('x-admin-password') ?? '') === pw;
}

export async function GET(req: Request) {
  if (!auth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const template = new URL(req.url).searchParams.get('template') ?? '';

  let html: string;
  switch (template) {
    // ── Trial drip ──────────────────────────────────────────────────────────
    case 'trial-d1':
      html = welcomeEmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;
    case 'trial-d2':
      html = featureTipsEmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;
    case 'trial-d3':
      html = proUpsellEmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;
    case 'trial-d4':
      html = annualDealEmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;
    case 'trial-d5':
      html = lastCallEmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;

    // ── Comp Ambassador drip ────────────────────────────────────────────────
    case 'comp-c1':
      html = compProForLifeEmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;
    case 'comp-c2':
      html = compC2EmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;
    case 'comp-c3':
      html = compC3EmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;
    case 'comp-c4':
      html = compC4EmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;
    case 'comp-c5':
      html = compC5EmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;

    // ── Paid drip ────────────────────────────────────────────────────────────
    case 'paid-p1':
      html = upgradeConfirmEmailHtml(PREVIEW_USER.name, PREVIEW_USER.id, 'pro', 'monthly');
      break;
    case 'paid-p2':
      html = paidCheckInEmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;
    case 'paid-p3':
      html = paidSpotlightEmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;
    case 'paid-p5':
      html = cancellationEmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;

    // ── Pro engagement drip ──────────────────────────────────────────────────
    case 'eng-s1':
      html = engS1EmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;
    case 'eng-s2':
      html = engS2EmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;
    case 'eng-s3':
      html = engS3EmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;
    case 'eng-s4':
      html = engS4EmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;
    case 'eng-s5':
      html = engS5EmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;

    // ── Fleet engagement drip ────────────────────────────────────────────────
    case 'eng-f1':
      html = engF1EmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;
    case 'eng-f2':
      html = engF2EmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;
    case 'eng-f3':
      html = engF3EmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;
    case 'eng-f4':
      html = engF4EmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;

    // ── Milestone emails ─────────────────────────────────────────────────────
    case 'eng-m1':
      html = milestoneM1EmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;
    case 'eng-m2':
      html = milestoneM2EmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;
    case 'eng-m3':
      html = milestoneM3EmailHtml(PREVIEW_USER.name, PREVIEW_USER.id);
      break;

    default:
      return NextResponse.json({ error: `Unknown template: ${template}` }, { status: 400 });
  }

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
