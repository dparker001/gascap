/**
 * POST /api/webhooks/ghl-placement
 *
 * Receives GHL form submissions from ambassadors and populates the station
 * details for the matching campaign placement.
 *
 * GHL form fields expected (map these in the GHL form builder):
 *   placard_code   — dropdown; one of the 50 GC-ORGFL-D1.01-XXXX codes
 *   station_name   — text field (required)
 *   address        — text field
 *   city           — text field (defaults to "Orlando")
 *   contact_name   — text field
 *   contact_email  — email field
 *   contact_phone  — phone field
 *   notes          — textarea (optional extra notes from ambassador)
 *
 * Security: include WEBHOOK_SECRET as a query param or x-webhook-secret header.
 * Set WEBHOOK_SECRET in Railway env vars and copy it into the GHL webhook URL.
 *
 * GHL webhook URL to configure:
 *   https://www.gascap.app/api/webhooks/ghl-placement?secret=YOUR_SECRET
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getPlacementByCode, updatePlacement } from '@/lib/campaigns';

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return false;
  const fromQuery  = req.nextUrl.searchParams.get('secret');
  const fromHeader = req.headers.get('x-webhook-secret');
  return fromQuery === secret || fromHeader === secret;
}

/** Pull a field from either a flat JSON body or GHL's nested customData array. */
function field(body: Record<string, unknown>, key: string): string {
  // Flat format: { placard_code: "...", station_name: "..." }
  if (typeof body[key] === 'string') return (body[key] as string).trim();

  // GHL webhook format: { customData: [{ name: "placard_code", value: "..." }] }
  const custom = body.customData as Array<{ name: string; value: string }> | undefined;
  if (Array.isArray(custom)) {
    const entry = custom.find((c) => c.name === key);
    if (entry?.value) return String(entry.value).trim();
  }

  // GHL contact field format: { contact: { customField: { placard_code: "..." } } }
  const contact = body.contact as Record<string, unknown> | undefined;
  if (contact) {
    const cf = contact.customField as Record<string, string> | undefined;
    if (cf?.[key]) return String(cf[key]).trim();
    if (typeof contact[key] === 'string') return (contact[key] as string).trim();
  }

  return '';
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    console.warn('[ghl-placement] 401 — missing or wrong WEBHOOK_SECRET. Check Railway env var and GHL webhook URL.');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    console.error('[ghl-placement] 400 — could not parse JSON body');
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  console.log('[ghl-placement] received body keys:', Object.keys(body).join(', '));

  const placardCode = field(body, 'placard_code');
  const stationName = field(body, 'station_name');

  console.log(`[ghl-placement] placard_code="${placardCode}" station_name="${stationName}"`);

  if (!placardCode) {
    console.error('[ghl-placement] 400 — placard_code missing. Check GHL field name mapping.');
    return NextResponse.json({ error: 'placard_code is required' }, { status: 400 });
  }
  if (!stationName) {
    console.error('[ghl-placement] 400 — station_name missing. Check GHL field name mapping.');
    return NextResponse.json({ error: 'station_name is required' }, { status: 400 });
  }

  const placement = getPlacementByCode(placardCode);
  if (!placement) {
    console.error(`[ghl-placement] 404 — no placement found for code: ${placardCode}`);
    return NextResponse.json(
      { error: `No placement found for code: ${placardCode}` },
      { status: 404 },
    );
  }

  const ambassadorNotes = field(body, 'notes');
  const baseNotes = placement.notes ?? '';
  const mergedNotes = ambassadorNotes
    ? `${baseNotes}\nAmbassador update: ${ambassadorNotes}`.trim()
    : baseNotes;

  const updated = updatePlacement(placement.id, {
    station:      stationName,
    address:      field(body, 'address')       || placement.address,
    city:         field(body, 'city')          || placement.city || 'Orlando',
    contactName:  field(body, 'contact_name')  || placement.contactName,
    contactEmail: field(body, 'contact_email') || placement.contactEmail,
    contactPhone: field(body, 'contact_phone') || placement.contactPhone,
    notes:        mergedNotes,
  });

  if (!updated) {
    return NextResponse.json({ error: 'Failed to update placement' }, { status: 500 });
  }

  console.log(`[ghl-placement] Updated ${placardCode} → ${stationName}`);

  return NextResponse.json({
    ok:      true,
    code:    updated.code,
    station: updated.station,
  });
}
