/**
 * /api/maps/autocomplete
 * POST { input: string } → { ok: boolean; suggestions: string[] }
 *
 * Proxies Google Places Autocomplete (New) to avoid exposing the API key
 * to the client. Returns up to 5 text predictions.
 *
 * Only active when GOOGLE_MAPS_TRIP_PLANNER_ENABLED=true.
 */
import { NextResponse } from 'next/server';

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
  try {
    const body = await req.json() as { input?: string };
    input = (body.input ?? '').trim();
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
      }),
    });

    if (!res.ok) {
      return NextResponse.json({ ok: true, suggestions: [] });
    }

    const data = await res.json() as GoogleAutocompleteResponse;
    const suggestions = (data.suggestions ?? [])
      .slice(0, 5)
      .map((s) => s.placePrediction?.text?.text ?? '')
      .filter(Boolean);

    return NextResponse.json({ ok: true, suggestions });
  } catch {
    return NextResponse.json({ ok: true, suggestions: [] });
  }
}
