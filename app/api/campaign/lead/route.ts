/**
 * POST /api/campaign/lead
 *
 * Public lead-capture endpoint for the QR placard campaign.
 * Stores a lead_capture event and pushes the contact straight into GHL
 * with attribution tags so the marketing automation can pick it up.
 *
 * Body: { name?, email, phone? }
 */
import { NextResponse, type NextRequest } from 'next/server';
import { logEvent, getPlacementByCode } from '@/lib/campaigns';
import { upsertGhlContact } from '@/lib/ghl';

export async function POST(req: NextRequest) {
  const placementCode = req.cookies.get('gc_src')?.value;

  let body: { name?: string; email?: string; phone?: string } = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 });
  }

  const email = body.email?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: 'valid email required' }, { status: 400 });
  }

  const sessionId = req.cookies.get('gc_ssn')?.value ?? `ssn_${Date.now().toString(36)}`;
  const placement = placementCode ? getPlacementByCode(placementCode) : undefined;

  // Log the campaign event (only if we have an attribution cookie)
  if (placementCode) {
    logEvent({
      placementCode,
      type:      'lead_capture',
      sessionId,
      path:      '/api/campaign/lead',
      userAgent: req.headers.get('user-agent') ?? undefined,
      meta:      { email, hasName: !!body.name, hasPhone: !!body.phone },
    });
  }

  // Push to GHL with rich attribution tags
  const extraTags = ['gascap-lead', 'gascap-qr-pilot'];
  if (placement) {
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
    phone:     body.phone?.trim(),
    plan:      'free',
    source:    placement ? `GasCap QR — ${placement.station}` : 'GasCap QR Pilot',
    extraTags,
  }).catch((err) => console.error('[GHL] lead capture sync failed:', err));

  return NextResponse.json({ ok: true, attributed: !!placementCode });
}
