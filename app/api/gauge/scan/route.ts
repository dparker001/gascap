/**
 * POST /api/gauge/scan
 * Claude Vision fuel-gauge reader — available to all plans.
 * Accepts: multipart/form-data with field "image" (JPEG/PNG/WebP/GIF)
 * Returns: GaugeScanResult
 */
import { NextResponse } from 'next/server';
import { getToken }    from 'next-auth/jwt';
import Anthropic       from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.GASCAP_ANTHROPIC_KEY });

export type GaugeType = 'analog_needle' | 'digital_percentage' | 'digital_bars' | 'unknown';

export interface GaugeScanResult {
  gaugeDetected:        boolean;
  gaugeType:            GaugeType;
  fuelPercent:          number | null;
  confidence:           number;        // 0–100
  reason:               string;
  needsUserConfirmation: boolean;
}

// SHELVED: gauge photo-scan is disabled to stop it consuming Anthropic tokens for
// all users (incl. free). The manual needle-drag gauge covers the same need for free.
// This server-side guard also protects against cached/old clients that still show the
// scan button. Flip to true (and GAUGE_SCAN_ENABLED in TargetFillForm.tsx) to restore.
const GAUGE_SCAN_ENABLED = false;

export async function POST(req: Request) {
  if (!GAUGE_SCAN_ENABLED) {
    return NextResponse.json({ error: 'Gauge scanning is currently unavailable. Set your fuel level with the gauge dial instead.' }, { status: 503 });
  }

  const token = await getToken({ req: req as Parameters<typeof getToken>[0]['req'], secret: process.env.NEXTAUTH_SECRET });
  if (!token?.sub && !token?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
      model:      'claude-sonnet-5',
      max_tokens: 700,
      messages: [{
        role: 'user',
        content: [
          {
            type:   'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          {
            type: 'text',
            text: `You are a vehicle fuel gauge expert analyzing a dashboard photo. Accuracy matters more than speed — reason carefully before committing to a number.

STEP 1 — LOCATE THE FUEL GAUGE
Find the fuel gauge in the image. It may be:
- Analog needle: a dial with E (Empty) and F (Full) labels, needle pointing to current level. Often has a pump icon and intermediate ticks (¼, ½, ¾).
- Digital percentage: a number like "87%" or "45%" on an info display.
- Digital bars: segmented bar graph showing fill level (like a battery icon).
- Not visible or unreadable.

STEP 2 — DETERMINE GAUGE TYPE
Classify as one of: analog_needle, digital_percentage, digital_bars, unknown.

STEP 3 — ESTIMATE FUEL LEVEL (reason step-by-step in the "analysis" field FIRST)
- Analog needle — THIS IS THE HARD CASE, do it carefully:
  * The needle sweeps along an ARC, not a vertical line. E is at one end of the arc, F at the other.
  * Identify the exact positions of the E end, the F end, and any ¼/½/¾ tick marks.
  * Estimate what FRACTION of the way along the E→F arc the needle tip sits. Judge angular position along the arc — do NOT judge by vertical height, which is a common mistake and reads low.
  * Map that fraction to a percent: E=0, ¼=25, ½=50, ¾=75, F=100. Interpolate between ticks.
  * If the needle sits exactly on or past the F tick, it is 100. If exactly on E or below, it is a single digit or 0. Otherwise give an honest interpolated value — do not bias high or low.
- Digital percentage: read the number exactly as shown.
- Digital bars: count lit/filled segments ÷ total segments × 100, nearest whole number.
- If genuinely unreadable (too dark, blurred, glare, gauge not in frame): set fuelPercent to null.

STEP 4 — ASSESS CONFIDENCE (0–100)
- 90–100: Gauge clearly visible, reading unambiguous (esp. digital readouts).
- 70–89: Gauge visible but some uncertainty (slight angle, needle between ticks, partial view).
- 50–69: Gauge partially obscured, glare, or reading is approximate.
- Below 50: Very uncertain — dark image, heavy glare, gauge barely visible.
- 0: No gauge found or completely unreadable.
Analog-needle readings between ticks should rarely exceed 85 confidence — they are inherently estimates.

Return ONLY valid JSON, no markdown, no code block. Put "analysis" FIRST and reason through the needle/arc position there BEFORE stating fuelPercent:
{
  "analysis": "2-4 sentences: where E and F are, where the needle points along the arc, what fraction that is, and how you mapped it to a percent",
  "gaugeDetected": true or false,
  "gaugeType": "analog_needle" | "digital_percentage" | "digital_bars" | "unknown",
  "fuelPercent": integer 0–100 or null,
  "confidence": integer 0–100,
  "reason": "one short sentence for the user",
  "needsUserConfirmation": true or false
}

Set needsUserConfirmation to true if confidence < 80 or gaugeDetected is false.`,
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
      return NextResponse.json<GaugeScanResult>({
        gaugeDetected: false,
        gaugeType: 'unknown',
        fuelPercent: null,
        confidence: 0,
        reason: 'Could not parse AI response.',
        needsUserConfirmation: true,
      });
    }

    const raw = JSON.parse(jsonMatch[0]) as Partial<GaugeScanResult>;

    const result: GaugeScanResult = {
      gaugeDetected:        raw.gaugeDetected === true,
      gaugeType:            (['analog_needle','digital_percentage','digital_bars','unknown'] as GaugeType[]).includes(raw.gaugeType as GaugeType)
                              ? raw.gaugeType as GaugeType
                              : 'unknown',
      fuelPercent:          raw.fuelPercent !== null && typeof raw.fuelPercent === 'number'
                              ? Math.max(0, Math.min(100, Math.round(raw.fuelPercent)))
                              : null,
      confidence:           typeof raw.confidence === 'number'
                              ? Math.max(0, Math.min(100, Math.round(raw.confidence)))
                              : 0,
      reason:               typeof raw.reason === 'string' ? raw.reason.slice(0, 200) : '',
      needsUserConfirmation: raw.needsUserConfirmation === true || (raw.confidence ?? 0) < 80 || raw.gaugeDetected !== true,
    };

    return NextResponse.json<GaugeScanResult>(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Scan failed: ${msg}` }, { status: 500 });
  }
}
