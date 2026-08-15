/**
 * POST /api/rental-sessions/scan-agreement
 *
 * Claude Vision/document scan of a rental agreement — accepts either a photo
 * (JPEG/PNG/WebP/GIF) or the emailed PDF, and returns normalized fields to
 * pre-fill the Rental Return Assistant setup flow. Pro-gated, same as the
 * fill-up receipt scanner it's modeled on (app/api/fillups/scan).
 *
 * Everything returned is a SUGGESTION. The renter reviews and can edit every
 * field before the session is created — an OCR misread of a fuel rate or
 * return time should never silently become the number a return decision is
 * made on.
 */
import { NextResponse } from 'next/server';
import { getToken }    from 'next-auth/jwt';
import { findById }    from '@/lib/users';
import { RENTAL_RETURN_ASSISTANT_ENABLED } from '@/lib/featureFlags';
import Anthropic       from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.GASCAP_ANTHROPIC_KEY });

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
const MAX_BYTES   = 12 * 1024 * 1024; // matches Anthropic's practical document limit

const EXTRACTION_PROMPT = `This is a car rental agreement (or rental confirmation). Extract the following and return ONLY a valid JSON object with these exact keys. Use null for anything you cannot find or are not confident about — do NOT guess.

{
  "rentalCompany": <string | null>,           // e.g. "Avis", "Hertz", "Enterprise"
  "rentalAgreementNumber": <string | null>,   // sometimes "RA" or "Agreement No."
  "rentalConfirmationNumber": <string | null>,// sometimes "Confirmation", "Res #", "Booking"
  "vehicleYear": <string | null>,
  "vehicleMake": <string | null>,
  "vehicleModel": <string | null>,
  "pickupDateTime": <string | null>,          // ISO 8601 "YYYY-MM-DDTHH:mm" if both known, else null
  "returnDateTime": <string | null>,          // ISO 8601 "YYYY-MM-DDTHH:mm" if both known, else null
  "returnLocation": <string | null>,          // address or airport of the RETURN/drop-off location
  "rentalFuelChargePerGallon": <number | null>,// the per-gallon refueling rate, dollars only, no "$"
  "fuelPolicy": <string | null>               // e.g. "Full to Full", "Prepaid fuel", "Same as pickup"
}

Important:
- rentalFuelChargePerGallon must be the RATE PER GALLON the company charges to refuel, not a prepaid fuel total or any other charge. If the document only shows a prepaid fuel purchase total, return null.
- If the same number appears as both agreement and confirmation, populate whichever the document actually labels it as and leave the other null.
- Return raw JSON with no markdown fences and no commentary.`;

export async function POST(req: Request) {
  if (!RENTAL_RETURN_ASSISTANT_ENABLED) return NextResponse.json({ error: 'Not available' }, { status: 404 });

  const token = await getToken({ req: req as Parameters<typeof getToken>[0]['req'], secret: process.env.NEXTAUTH_SECRET });
  if (!token?.sub && !token?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (token.id ?? token.sub ?? '') as string;
  const user   = await findById(userId);
  if (!user || user.plan === 'free') {
    return NextResponse.json(
      { error: 'Scanning a rental agreement is a Pro feature. You can still enter the details manually.', upgrade: true },
      { status: 403 },
    );
  }

  if (!process.env.GASCAP_ANTHROPIC_KEY) {
    return NextResponse.json({ error: 'AI not configured.' }, { status: 503 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data.' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file provided.' }, { status: 400 });

  const isPdf   = file.type === 'application/pdf';
  const isImage = (IMAGE_TYPES as readonly string[]).includes(file.type);
  if (!isPdf && !isImage) {
    return NextResponse.json({ error: 'Upload a PDF or a photo (JPEG, PNG, WebP, or GIF).' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'That file is too large — try a photo of the first page instead.' }, { status: 400 });
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');

  try {
    const message = await anthropic.messages.create({
      model:      'claude-opus-4-5',
      max_tokens: 900,
      messages: [{
        role: 'user',
        content: [
          isPdf
            ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 } }
            : { type: 'image' as const,    source: { type: 'base64' as const, media_type: file.type as typeof IMAGE_TYPES[number], data: base64 } },
          { type: 'text' as const, text: EXTRACTION_PROMPT },
        ],
      }],
    });

    const raw = message.content.find((b) => b.type === 'text');
    if (!raw || raw.type !== 'text') {
      return NextResponse.json({ error: 'Could not read that agreement.' }, { status: 422 });
    }

    // Strip accidental markdown fences before parsing.
    const cleaned = raw.text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      console.error('[scan-agreement] Non-JSON model response:', cleaned.slice(0, 300));
      return NextResponse.json({ error: 'Could not read that agreement — try entering the details manually.' }, { status: 422 });
    }

    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const num = (v: unknown) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);

    return NextResponse.json({
      ok: true,
      fields: {
        rentalCompany:            str(parsed.rentalCompany),
        rentalAgreementNumber:    str(parsed.rentalAgreementNumber),
        rentalConfirmationNumber: str(parsed.rentalConfirmationNumber),
        vehicleYear:              str(parsed.vehicleYear),
        vehicleMake:              str(parsed.vehicleMake),
        vehicleModel:             str(parsed.vehicleModel),
        pickupDateTime:           str(parsed.pickupDateTime),
        returnDateTime:           str(parsed.returnDateTime),
        returnLocation:           str(parsed.returnLocation),
        rentalFuelChargePerGallon: num(parsed.rentalFuelChargePerGallon),
        fuelPolicy:               str(parsed.fuelPolicy),
      },
    });
  } catch (err) {
    console.error('[scan-agreement] Claude call failed:', err);
    return NextResponse.json({ error: 'Scan failed — try again or enter the details manually.' }, { status: 502 });
  }
}
