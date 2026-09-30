/**
 * Classifies a /gas/nearby (or /api/nearby-gas) response so callers can tell
 * "searched, nothing priced nearby" apart from "couldn't search at all".
 *
 * Those routes return HTTP 200 with `stations: []` for a Pro-gate refusal
 * (`proRequired`), for live prices switched off (`disabled`), and for a
 * missing key (`error`) — rendering all of them as "no stations found" makes
 * a working feature look broken (and hides a stale-JWT plan problem).
 */
export type NearbyResponseKind = 'ok' | 'pro_required' | 'disabled' | 'error';

export interface NearbyResponseBody {
  stations?:    unknown[];
  proRequired?: boolean;
  reason?:      string;
  disabled?:    boolean;
  error?:       string;
}

export function classifyNearbyResponse(httpOk: boolean, body: NearbyResponseBody | null): NearbyResponseKind {
  if (!httpOk || !body)  return 'error';
  if (body.proRequired)  return 'pro_required';
  if (body.disabled)     return 'disabled';
  if (body.error)        return 'error';
  return 'ok';
}
