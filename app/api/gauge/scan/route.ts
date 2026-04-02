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

GAUGE TYPES — look for ANY of these:

Analog needle gauges (most common):
- VERTICAL sweep: needle moves up (Full/F at top) and down (Empty/E at bottom) — common on right side of instrument cluster. E is at the BOTTOM, F is at the TOP.
- HORIZONTAL sweep: needle moves left/right along a curved or straight arc — E on the left, F on the right (or sometimes reversed).
- SEMICIRCULAR arc: needle sweeps in a half-circle — E on one end, F on the other.
- The needle pivot point and the E/F labels are the key reference points regardless of orientation.

Digital displays:
- Bar graph or segmented bars showing fuel level
- Fraction display (e.g. "1/4", "1/2", "3/4", "FULL")
- Percentage display (e.g. "87%", "45%")
- Icon with fill level indicator

HOW TO INTERPRET:
- Locate the E (Empty) and F (Full) labels or endpoints first
- For vertical gauges: measure how far the needle is from E (bottom) toward F (top) as a percentage of the total travel distance
- For horizontal/arc gauges: measure needle position as percentage from E end to F end
- For digital bars: count lit/filled segments ÷ total segments × 100
- E or Empty = 0%, ¼ tank = 25%, ½ tank = 50%, ¾ tank = 75%, F or Full = 100%
- Round to the nearest 5%

WHEN TO RETURN NULL:
- No fuel gauge visible in the image
- Gauge is too blurry, dark, or obscured to read
- Cannot confidently locate the needle or E/F endpoints
- Image shows something other than a vehicle fuel gauge

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
