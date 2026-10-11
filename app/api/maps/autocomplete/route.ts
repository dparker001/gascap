/**
 * /api/maps/autocomplete
 * POST { input: string, sessionToken?: string } → { ok: boolean; suggestions: string[] }
 *
 * Proxies Google Places Autocomplete (New) to avoid exposing the API key
 * to the client. Returns up to 5 text predictions.
 *
 * sessionToken (2026-10-11, Trip Planner Phase 2): optional, forwarded to
 * Google as-is. Groups this search's keystroke-by-keystroke Autocomplete
 * calls with the eventual /api/maps/place-location lookup into one billed
 * session instead of charging each request separately — generate one via
 * lib/placesSessionToken.ts when a field gains focus, reuse it across
 * keystrokes, and start a fresh one after a selection is resolved.
 *
 * Only active when GOOGLE_MAPS_TRIP_PLANNER_ENABLED=true.
 */
import { NextResponse } from 'next/server';

export interface AutocompleteSuggestion {
  text:    string;
  placeId: string;
}

interface GoogleSuggestion {
  placePrediction?: {
    text?: { text: string };
    placeId?: string;
  };
}

interface GoogleAutocompleteResponse {
  suggestions?: GoogleSuggestion[];
}

export async function POST(req: Request) {
  const apiKey  = process.env.GOOGLE_MAPS_API_KEY;
  const enabled = process.env.GOOGLE_MAPS_TRIP_PLANNER_ENABLED === 'true';

  if (!apiKey || !enabled) {
    return NextResponse.json({ ok: true, suggestions: [] });
  }

  let input: string;
  let sessionToken: string | undefined;
  try {
    const body = await req.json() as { input?: string; sessionToken?: string };
    input = (body.input ?? '').trim();
    sessionToken = typeof body.sessionToken === 'string' && body.sessionToken ? body.sessionToken : undefined;
  } catch {
    return NextResponse.json({ ok: false, suggestions: [] }, { status: 400 });
  }

  if (input.length < 2) {
    return NextResponse.json({ ok: true, suggestions: [] });
  }

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
      },
      body: JSON.stringify({
        input,
        // Bias toward North America (US, Canada, Mexico); adjust as needed
        includedRegionCodes: ['us', 'ca', 'mx'],
        ...(sessionToken ? { sessionToken } : {}),
      }),
    });

    if (!res.ok) {
      return NextResponse.json({ ok: true, suggestions: [] });
    }

    const data = await res.json() as GoogleAutocompleteResponse;
    const results: AutocompleteSuggestion[] = (data.suggestions ?? [])
      .slice(0, 5)
      .map((s) => ({ text: s.placePrediction?.text?.text ?? '', placeId: s.placePrediction?.placeId ?? '' }))
      .filter((s) => s.text && s.placeId);

    // `suggestions` (text-only) kept for existing callers (TripCostEstimator);
    // `results` additionally carries placeId so callers that need real
    // coordinates (e.g. the Rental Return Assistant's return location) can
    // resolve a selection via /api/maps/place-location.
    return NextResponse.json({ ok: true, suggestions: results.map((s) => s.text), results });
  } catch {
    return NextResponse.json({ ok: true, suggestions: [] });
  }
}
