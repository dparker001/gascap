/**
 * POST /api/gauge/scan
 * Fuel-gauge reader — Pro plan required.
 *
 * Pipeline (accuracy-first):
 *   1. Claude Vision LOCATES landmarks (pivot, needle tip, E end, F end) + gauge type +
 *      image quality, and independently gives a holistic % guess.
 *   2. We compute the fuel % from the needle's angle in code (lib/gaugeGeometry) — the
 *      deterministic step the model is bad at.
 *   3. Self-consistency cross-check: geometry % vs holistic %. Big disagreement → low
 *      confidence + retakeRequired, so we ask the user to retry rather than guess wrong.
 *
 * Accepts: multipart/form-data — "image" (JPEG/PNG/WebP/GIF), optional "aspect" (w/h).
 */
import { NextResponse } from 'next/server';
import { getToken }    from 'next-auth/jwt';
import { findById }    from '@/lib/users';
import Anthropic       from '@anthropic-ai/sdk';
import { computeGaugePercent, type Pt } from '@/lib/gaugeGeometry';

const anthropic = new Anthropic({ apiKey: process.env.GASCAP_ANTHROPIC_KEY });

export type GaugeType = 'analog_needle' | 'digital_percentage' | 'digital_bars' | 'unknown';

export interface GaugeScanResult {
  // Core fields (backward-compatible with the existing client)
  gaugeDetected:         boolean;
  gaugeType:             GaugeType;
  fuelPercent:           number | null;   // final answer, 0–100
  confidence:            number;          // 0–100
  reason:                string;
  needsUserConfirmation: boolean;
  // Geometry-pipeline fields
  estimatedFuelPercentage: number | null;
  confidenceScore:         number;
  detectedNeedleAngle:     number | null;
  emptyAngle:              number | null;
  fullAngle:               number | null;
  imageQualityStatus:      string;        // good | glare | dark | blurry | too_far | partial | unknown
  retakeRequired:          boolean;
}

// Cross-check tolerance: geometry vs holistic disagreement above this (percentage
// points) means we don't trust the read and ask for a retake / manual confirm.
const CROSS_CHECK_TOLERANCE = 12;

interface ModelOut {
  gaugeDetected?:   boolean;
  gaugeType?:       string;
  imageQuality?:    string;
  pivot?:           Pt | null;
  needleTip?:       Pt | null;
  empty?:           Pt | null;
  full?:            Pt | null;
  holisticPercent?: number | null;
  digitalPercent?:  number | null;
  reason?:          string;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const okType = (t: string | undefined): GaugeType =>
  (['analog_needle', 'digital_percentage', 'digital_bars', 'unknown'] as GaugeType[]).includes(t as GaugeType)
    ? (t as GaugeType) : 'unknown';
const intOrNull = (v: unknown): number | null =>
  typeof v === 'number' && isFinite(v) ? clamp(Math.round(v), 0, 100) : null;

export async function POST(req: Request) {
  const token = await getToken({ req: req as Parameters<typeof getToken>[0]['req'], secret: process.env.NEXTAUTH_SECRET });
  if (!token?.sub && !token?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (token.id ?? token.sub ?? '') as string;
  const user   = await findById(userId);
  if (!user || user.plan === 'free') {
    return NextResponse.json(
      { error: 'Gauge scanning is a Pro feature. Upgrade to read your fuel level from a photo.', upgrade: true },
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

  const aspectRaw = parseFloat((formData.get('aspect') as string) ?? '');
  const aspect    = isFinite(aspectRaw) && aspectRaw > 0 ? aspectRaw : 1;

  const bytes     = await file.arrayBuffer();
  const base64    = Buffer.from(bytes).toString('base64');
  const mediaType = file.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

  try {
    const message = await anthropic.messages.create({
      model:      'claude-sonnet-5',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          {
            type: 'text',
            text: `You are locating landmarks on a vehicle fuel gauge so software can compute the level geometrically. Do NOT try to compute the final percentage from the ratio yourself — just locate points precisely.

Coordinates are normalized: x = fraction of image WIDTH (0=left, 1=right), y = fraction of image HEIGHT (0=top, 1=bottom). Give 2–3 decimals.

Classify gaugeType:
- analog_needle: a rotating needle on a dial/arc with E (empty) and F (full) ends. MOST COMMON.
- digital_percentage: a numeric readout like "72%".
- digital_bars: a segmented bar/battery-style indicator.
- unknown: no fuel gauge visible or unreadable.

For analog_needle, locate these four points as precisely as you can:
- pivot: the needle's rotation center (where the needle is anchored — often below/behind the dial).
- needleTip: the pointed end of the needle (the end AWAY from the pivot).
- empty: the E mark / empty end of the fuel scale (may be the letter E, a pump-empty icon, or the first tick).
- full: the F mark / full end of the fuel scale (letter F or the last tick).
If it is NOT a rotating needle (digital, or a straight horizontal/vertical bar), set pivot/needleTip/empty/full to null.

Also report:
- holisticPercent: your own best independent estimate of the fuel level 0–100 (used only as a sanity cross-check). Give this for EVERY gauge type.
- digitalPercent: for digital_percentage/digital_bars, the exact level read from the display (else null).
- imageQuality: one of good | glare | dark | blurry | too_far | partial.
- reason: one short sentence.

Return ONLY valid JSON, no markdown:
{
  "gaugeDetected": true|false,
  "gaugeType": "analog_needle"|"digital_percentage"|"digital_bars"|"unknown",
  "imageQuality": "good"|"glare"|"dark"|"blurry"|"too_far"|"partial",
  "pivot": {"x":0.0,"y":0.0} | null,
  "needleTip": {"x":0.0,"y":0.0} | null,
  "empty": {"x":0.0,"y":0.0} | null,
  "full": {"x":0.0,"y":0.0} | null,
  "holisticPercent": 0-100 | null,
  "digitalPercent": 0-100 | null,
  "reason": "one sentence"
}`,
          },
        ],
      }],
    });

    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json<GaugeScanResult>(failure('Could not parse AI response.'));

    const m = JSON.parse(jsonMatch[0]) as ModelOut;

    const gaugeType     = okType(m.gaugeType);
    const gaugeDetected = m.gaugeDetected === true && gaugeType !== 'unknown';
    const imageQuality  = typeof m.imageQuality === 'string' ? m.imageQuality : 'unknown';
    const reason        = typeof m.reason === 'string' ? m.reason.slice(0, 200) : '';
    const holistic      = intOrNull(m.holisticPercent);
    const digital       = intOrNull(m.digitalPercent);
    const badQuality    = ['dark', 'glare', 'blurry', 'too_far', 'partial'].includes(imageQuality);

    if (!gaugeDetected) {
      return NextResponse.json<GaugeScanResult>(failure(reason || 'No fuel gauge detected.', imageQuality));
    }

    // ── Digital gauges: no geometry, use the direct read ──
    if (gaugeType === 'digital_percentage' || gaugeType === 'digital_bars') {
      const value = digital ?? holistic;
      if (value === null) return NextResponse.json<GaugeScanResult>(failure(reason || 'Could not read the display.', imageQuality));
      const confidence = digital !== null ? (badQuality ? 72 : 90) : 60;
      return NextResponse.json<GaugeScanResult>(build({
        gaugeDetected: true, gaugeType, percent: value, confidence,
        reason: reason || 'Read from the digital display.',
        needleAngle: null, emptyAngle: null, fullAngle: null,
        imageQuality, retake: confidence < 60,
      }));
    }

    // ── Analog needle: geometry is primary ──
    const geom = computeGaugePercent(m.pivot ?? null, m.needleTip ?? null, m.empty ?? null, m.full ?? null, aspect);

    if (geom.ok && geom.percent !== null) {
      // Cross-check geometry against the model's holistic guess.
      if (holistic !== null) {
        const diff = Math.abs(geom.percent - holistic);
        if (diff > CROSS_CHECK_TOLERANCE) {
          return NextResponse.json<GaugeScanResult>(build({
            gaugeDetected: true, gaugeType, percent: geom.percent,
            confidence: clamp(50 - (diff - CROSS_CHECK_TOLERANCE), 20, 50),
            reason: 'The geometry and a second read disagreed — please retake or confirm the level manually.',
            needleAngle: geom.needleAngle, emptyAngle: geom.emptyAngle, fullAngle: geom.fullAngle,
            imageQuality, retake: true,
          }));
        }
        const confidence = clamp(Math.round(94 - diff * 2) - (badQuality ? 10 : 0), 62, 94);
        return NextResponse.json<GaugeScanResult>(build({
          gaugeDetected: true, gaugeType, percent: geom.percent, confidence,
          reason: reason || 'Computed from the needle angle.',
          needleAngle: geom.needleAngle, emptyAngle: geom.emptyAngle, fullAngle: geom.fullAngle,
          imageQuality, retake: false,
        }));
      }
      // Geometry only (no holistic to cross-check) — usable but flag for confirmation.
      return NextResponse.json<GaugeScanResult>(build({
        gaugeDetected: true, gaugeType, percent: geom.percent,
        confidence: badQuality ? 58 : 70,
        reason: reason || 'Computed from the needle angle.',
        needleAngle: geom.needleAngle, emptyAngle: geom.emptyAngle, fullAngle: geom.fullAngle,
        imageQuality, retake: false,
      }));
    }

    // Geometry failed (landmarks missing/degenerate). Fall back to holistic if we have it.
    if (holistic !== null) {
      return NextResponse.json<GaugeScanResult>(build({
        gaugeDetected: true, gaugeType, percent: holistic, confidence: 48,
        reason: 'Could not pin the needle precisely — showing an approximate read. Please confirm.',
        needleAngle: geom.needleAngle, emptyAngle: geom.emptyAngle, fullAngle: geom.fullAngle,
        imageQuality, retake: true,
      }));
    }

    return NextResponse.json<GaugeScanResult>(failure(reason || 'Could not read the gauge — try a clearer, closer photo.', imageQuality));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Scan failed: ${msg}` }, { status: 500 });
  }
}

// ── Result builders ──────────────────────────────────────────────────────────

function build(a: {
  gaugeDetected: boolean; gaugeType: GaugeType; percent: number; confidence: number;
  reason: string; needleAngle: number | null; emptyAngle: number | null; fullAngle: number | null;
  imageQuality: string; retake: boolean;
}): GaugeScanResult {
  return {
    gaugeDetected:         a.gaugeDetected,
    gaugeType:             a.gaugeType,
    fuelPercent:           a.percent,
    confidence:            a.confidence,
    reason:                a.reason,
    needsUserConfirmation: a.retake || a.confidence < 80,
    estimatedFuelPercentage: a.percent,
    confidenceScore:         a.confidence,
    detectedNeedleAngle:     a.needleAngle,
    emptyAngle:              a.emptyAngle,
    fullAngle:               a.fullAngle,
    imageQualityStatus:      a.imageQuality,
    retakeRequired:          a.retake,
  };
}

function failure(reason: string, imageQuality = 'unknown'): GaugeScanResult {
  return {
    gaugeDetected: false, gaugeType: 'unknown', fuelPercent: null, confidence: 0,
    reason, needsUserConfirmation: true,
    estimatedFuelPercentage: null, confidenceScore: 0, detectedNeedleAngle: null,
    emptyAngle: null, fullAngle: null, imageQualityStatus: imageQuality, retakeRequired: true,
  };
}
