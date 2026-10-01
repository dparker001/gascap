/**
 * POST /api/campaign/lead
 *
 * Public lead-capture endpoint for the QR placard campaign.
 * Stores a lead_capture event and pushes the contact straight into GHL
 * with attribution tags so the marketing automation can pick it up.
 *
 * Body: { name?, email, phone?, emailConsent, smsConsent? }
 *
 * Consent ($20 Gift Campaign, 2026-10-01): a lead is a marketing opt-in, so
 * `emailConsent: true` is required — without it nothing is stored or sent to
 * GHL (400). A phone number is forwarded to GHL ONLY with `smsConsent: true`;
 * otherwise it's dropped, so an unconsented number never reaches the SMS
 * system. The consent flags + copy version are recorded on the event. No
 * in-repo caller existed before this change.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { logEvent, getPlacementByCode } from '@/lib/campaigns';
import { upsertGhlContact } from '@/lib/ghl';
import { GIFT20_CONSENT_VERSION } from '@/lib/gift20';

export async function POST(req: NextRequest) {
  const placementCode = req.cookies.get('gc_src')?.value;

  let body: {
    name?: string; email?: string; phone?: string;
    emailConsent?: unknown; smsConsent?: unknown;
  } = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 });
  }

  const email = body.email?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: 'valid email required' }, { status: 400 });
  }

  if (body.emailConsent !== true) {
    return NextResponse.json({ ok: false, error: 'email consent required' }, { status: 400 });
  }
  const smsConsent     = body.smsConsent === true;
  const phone          = smsConsent ? (body.phone?.trim() || undefined) : undefined;
  // Server-side constant, never client-supplied — the record should say
  // which consent copy this server was actually serving.
  const consentVersion = GIFT20_CONSENT_VERSION;

  const sessionId = req.cookies.get('gc_ssn')?.value ?? `ssn_${Date.now().toString(36)}`;
  const placement = placementCode ? await getPlacementByCode(placementCode) : undefined;

  // Log the campaign event (only if we have an attribution cookie)
  if (placementCode) {
    logEvent({
      placementCode,
      type:      'lead_capture',
      sessionId,
      path:      '/api/campaign/lead',
      userAgent: req.headers.get('user-agent') ?? undefined,
      meta:      { email, hasName: !!body.name, hasPhone: !!phone, emailConsent: true, smsConsent, consentVersion },
    });
  }

  // Push to GHL with rich attribution tags
  // Consent travels with the contact into GHL (durable, and present even when
  // there is no gc_src cookie and therefore no campaign event to record it).
  const extraTags = ['gascap-lead', 'gascap-qr-pilot', 'gascap-email-consent', `gascap-consent-${consentVersion}`];
  if (smsConsent && phone) extraTags.push('gascap-sms-consent');
  if (placement) {
    extraTags.push(`gascap-campaign-${placement.campaign.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
    extraTags.push(
      `gascap-station-${placement.station.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      `gascap-placement-${placement.placement.toLowerCase()}`,
      `gascap-headline-${placement.headlineVariant.toLowerCase()}`,
      `gascap-code-${placement.code.toLowerCase()}`,
    );
    if (placement.city) {
      extraTags.push(`gascap-city-${placement.city.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
    }
  }

  upsertGhlContact({
    name:      body.name?.trim() || email.split('@')[0],
    email,
    phone,
    plan:      'free',
    source:    placement ? `GasCap QR — ${placement.station}` : 'GasCap QR Pilot',
    extraTags,
  }).catch((err) => console.error('[GHL] lead capture sync failed:', err));

  return NextResponse.json({ ok: true, attributed: !!placementCode });
}
