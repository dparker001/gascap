/**
 * POST /api/gauge/scan
 * Claude Vision fuel-gauge reader — available to all plans.
 * Accepts: multipart/form-data with field "image" (JPEG/PNG/WebP/GIF)
 * Returns: { percent: number | null }  (0–100, integer)
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
            text: `You are reading a vehicle fuel gauge from a photo taken by a driver.

WHAT TO LOOK FOR:
- An analog arc-shaped gauge with a needle pointing between E (empty) and F (full)
- A digital bar-graph or segmented display showing fuel level
- A digital percentage or fraction display (e.g. "1/2", "3/4", "87%")
- The gauge may be on a dashboard, instrument cluster, or a standalone fuel gauge face

HOW TO INTERPRET:
- E or Empty = 0%
- 1/4 tank = 25%
- 1/2 tank = 50%
- 3/4 tank = 75%
- F or Full = 100%
- For analog needles: estimate the needle's position as a percentage of the arc from E to F
- For digital segments: count lit segments vs total segments
- Round to the nearest 5% (e.g. 25, 30, 50, 75)

WHEN TO RETURN NULL:
- The image does not show a fuel gauge at all
- The gauge is too blurry or obscured to read
- You cannot confidently determine the fuel level
- The image shows something other than a vehicle fuel gauge

Return ONLY a JSON object, no markdown, no explanation:
{"percent": <integer 0–100 or null>}`,
          },
        ],
      }],
    });

    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ percent: null });

    const data = JSON.parse(jsonMatch[0]) as { percent: number | null };

    if (data.percent !== null && typeof data.percent === 'number') {
      const clamped = Math.max(0, Math.min(100, Math.round(data.percent)));
      return NextResponse.json({ percent: clamped });
    }
    return NextResponse.json({ percent: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Scan failed: ${msg}` }, { status: 500 });
  }
}
