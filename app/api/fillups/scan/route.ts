/**
 * POST /api/fillups/scan
 * Claude Vision receipt scanner — Pro plan required.
 * Accepts: multipart/form-data with field "image" (JPEG/PNG/WebP/GIF)
 * Returns: { gallons, pricePerGallon, totalCost, date, stationName } (any may be null)
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { findById }         from '@/lib/users';
import Anthropic            from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.GASCAP_ANTHROPIC_KEY });

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const user   = findById(userId);
  if (!user || user.plan === 'free') {
    return NextResponse.json(
      { error: 'Receipt scanning is a Pro feature. Upgrade to scan receipts automatically.', upgrade: true },
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

  const file = formData.get('image') as File | null;
  if (!file) return NextResponse.json({ error: 'No image provided.' }, { status: 400 });

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: 'Image must be JPEG, PNG, WebP, or GIF.' }, { status: 400 });
  }

  const bytes    = await file.arrayBuffer();
  const base64   = Buffer.from(bytes).toString('base64');
  const mediaType = file.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

  try {
    const message = await anthropic.messages.create({
      model:      'claude-opus-4-5',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: [
          {
            type:   'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          {
            type: 'text',
            text: `This is a gas station receipt or fuel pump receipt. Extract the following details and return ONLY a valid JSON object with these exact keys (use null for any value you cannot find or are not confident about):

{
  "gallons": <number | null>,
  "pricePerGallon": <number | null>,
  "totalCost": <number | null>,
  "date": <"YYYY-MM-DD" string | null>,
  "stationName": <string | null>
}

Rules:
- gallons: the number of gallons/litres purchased (convert litres to gallons if needed: 1 L = 0.264172 gal)
- pricePerGallon: price per gallon in USD (convert per-litre prices if needed)
- totalCost: total dollar amount charged
- date: the transaction date in YYYY-MM-DD format
- stationName: the gas station or brand name if visible
- Return ONLY the JSON object. No explanation, no markdown, no extra text.`,
          },
        ],
      }],
    });

    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Could not extract receipt data from image.' }, { status: 422 });
    }

    const data = JSON.parse(jsonMatch[0]) as {
      gallons:       number | null;
      pricePerGallon: number | null;
      totalCost:     number | null;
      date:          string | null;
      stationName:   string | null;
    };

    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Scan failed: ${msg}` }, { status: 500 });
  }
}
