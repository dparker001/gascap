/**
 * Marketing Boost API client — automated vacation-incentive fulfillment.
 *
 * Replaces the old manual flow (admin logs into the MB members portal and
 * issues a certificate by hand for every Lifetime sale).
 *
 * getMBDestinations()/getActiveMBDestinations() below hit MB's account-scoped
 * GET /all-destination-list endpoint — kept for reference/admin-dashboard use,
 * but DO NOT treat it as authoritative for "what this account can send."
 * Confirmed 2026-07-26: it only returns a small curated subset (9 destinations)
 * while MB's actual send API happily accepts destination IDs far outside that
 * list (all 6 of GETAWAY_DESTINATIONS' mbDestinationId values, sourced directly
 * from MB support and verified with real test sends, work fine). The getaway
 * choose flow (app/api/getaway/choose) uses the hardcoded, verified IDs on
 * each GetawayDestination in lib/getawayPromo.ts instead of this GET endpoint.
 */

const API_BASE    = 'https://members.marketingboost.com/api';
const API_KEY      = process.env.MARKETINGBOOST_API_KEY ?? '';
const BUSINESS_ID  = process.env.MARKETINGBOOST_BUSINESS_ID ?? '';
const SENDER       = process.env.MARKETINGBOOST_SENDER ?? ''; // e.g. "44302-45991" — do not change once set
// The destination-list GET path uses only the first segment of the sender value.
const DESTINATION_LIST_ID = SENDER.split('-')[0];

export interface MBDestination {
  id:         string;  // MB's destination ID, e.g. "41"
  name:       string;  // e.g. "Las Vegas, NV"
  country:    string;
  active:     boolean;
  packageName: string;
  nights:     number;
  days:       number;
  nightlyFee: number;
  totalFee:   number;
}

interface RawDestination {
  destination_name: string;
  country_name:     string;
  status:           string; // "Active" | "In-Active"
  package_name:      string;
  nights:            string;
  days:              number;
  nightly_fee:       number;
  total_fee:         number;
}

let cache: { at: number; data: MBDestination[] } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — catalog changes rarely

/** Full destination catalog for this MB account (both active and inactive), live, cached 1hr. */
export async function getMBDestinations(): Promise<MBDestination[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
  if (!API_KEY || !DESTINATION_LIST_ID) {
    console.warn('[marketingBoost] Not configured (missing API key or sender) — returning empty catalog');
    return [];
  }

  try {
    const url = `${API_BASE}/all-destination-list/${DESTINATION_LIST_ID}?business=${encodeURIComponent(BUSINESS_ID)}&sender=${encodeURIComponent(SENDER)}`;
    const res = await fetch(url, { headers: { 'X-Api-Key': API_KEY } });
    if (!res.ok) {
      console.error('[marketingBoost] destination list fetch failed:', res.status, await res.text().catch(() => ''));
      return cache?.data ?? [];
    }
    const json = await res.json() as Record<string, RawDestination>;
    const data: MBDestination[] = Object.entries(json).map(([id, d]) => ({
      id,
      name:        d.destination_name,
      country:     d.country_name,
      active:      d.status === 'Active',
      packageName: d.package_name,
      nights:      Number(d.nights),
      days:        d.days,
      nightlyFee:  d.nightly_fee,
      totalFee:    d.total_fee,
    }));
    cache = { at: Date.now(), data };
    return data;
  } catch (err) {
    console.error('[marketingBoost] destination list fetch threw:', err);
    return cache?.data ?? [];
  }
}

/** Only the currently-bookable destinations. */
export async function getActiveMBDestinations(): Promise<MBDestination[]> {
  return (await getMBDestinations()).filter((d) => d.active);
}

export interface SendVacationResult {
  ok:      boolean;
  message?: string;
  error?:   string;
}

/** Send a vacation-incentive redemption link via Marketing Boost. */
export async function sendVacationIncentive(opts: {
  destinationId: string;
  name:          string;
  email:         string;
  countrycode?:  string;
  phone?:        string;
  message?:      string;
}): Promise<SendVacationResult> {
  if (!API_KEY || !SENDER || !BUSINESS_ID) {
    return { ok: false, error: 'Marketing Boost not configured (missing API key, sender, or business ID)' };
  }
  try {
    const res = await fetch(`${API_BASE}/vacation-incentives/send`, {
      method:  'POST',
      headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender:      SENDER,
        business:    BUSINESS_ID,
        destination: opts.destinationId,
        name:        opts.name,
        email:       opts.email,
        ...(opts.countrycode ? { countrycode: opts.countrycode } : {}),
        ...(opts.phone       ? { phone: opts.phone }             : {}),
        ...(opts.message     ? { message: opts.message }         : {}),
      }),
    });
    const json = await res.json().catch(() => ({})) as { status?: boolean; message?: string; errors?: string };
    if (!res.ok || json.status !== true) {
      return { ok: false, error: json.errors ?? json.message ?? `HTTP ${res.status}` };
    }
    return { ok: true, message: json.message };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
