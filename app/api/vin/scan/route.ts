/**
 * POST /api/vin/scan
 * Claude Vision VIN scanner — available to all plans.
 * Accepts: multipart/form-data with field "image" (JPEG/PNG/WebP/GIF)
 * Returns: { vin: string | null }
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import Anthropic            from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.GASCAP_ANTHROPIC_KEY });

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.GASCAP_ANTHROPIC_KEY) {
    return NextResponse.json({ error: 'AI not configured.' }, { status: 503 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data.' }, { status: 400 });
  }

  const file = formData.get('image') as File | null;
  if (!file) return NextResponse.json({ error: 'No image provided.' }, { status: 400 });

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: 'Image must be JPEG, PNG, WebP, or GIF.' }, { status: 400 });
  }

  const bytes     = await file.arrayBuffer();
  const base64    = Buffer.from(bytes).toString('base64');
  const mediaType = file.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

  try {
    const message = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: [
          {
            type:   'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          {
            type: 'text',
            text: `Extract the Vehicle Identification Number (VIN) from this image.

RULES:
- A VIN is exactly 17 characters using letters A-H, J-N, P-Z and digits 0-9. Letters I, O, and Q are NEVER in a VIN.
- Door jamb stickers contain many numbers (GVWR, GAWR, tire pressures, axle codes, etc.). ONLY use the sequence that is explicitly labeled "VIN" or "V.I.N." on the sticker — never guess from unlabeled numbers.
- Dashboard VIN plates typically show just one 17-character sequence — use that.
- VINs commonly start with a 3-character World Manufacturer Identifier such as 1HG, 2T1, JTD, WBA, KM8, 5NP, 1FT, 3VW, etc.
- If a "VIN" label is present, extract ONLY that labeled sequence. Ignore all other numbers on the label.
- If the image is blurry, the VIN label is not visible, or you cannot confidently read all 17 characters, return null — do not guess.

Return ONLY a JSON object, no markdown, no explanation:
{"vin": "<17-char VIN or null>"}`,
          },
        ],
      }],
    });

    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ vin: null });

    const data = JSON.parse(jsonMatch[0]) as { vin: string | null };

    // Validate the VIN format before returning
    if (data.vin && /^[A-HJ-NPR-Z0-9]{17}$/.test(data.vin.toUpperCase())) {
      return NextResponse.json({ vin: data.vin.toUpperCase() });
    }
    return NextResponse.json({ vin: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Scan failed: ${msg}` }, { status: 500 });
  }
}
