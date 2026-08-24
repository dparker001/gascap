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

/**
 * Vacation-incentive send outcome — deliberately richer than the plain
 * `SendVacationResult` used by hotel/dining below (scoped to this one
 * caller so those unrelated reward flows are never affected).
 *
 * A definitive rejected/sent classification is only possible when Marketing
 * Boost's HTTP response was actually read — a genuine `fetch` throw (network
 * error, timeout, connection reset, process interruption) gives NO evidence
 * either way: MB may have already accepted and sent the certificate before
 * the exception occurred. Collapsing that into "failed" (as the old
 * `{ok:false}` contract did) let a caller safely assume "safe to tell the
 * customer/admin this failed and needs manual reissue" — which is exactly
 * the assumption that risks a duplicate certificate. 'unknown' exists so
 * the caller (app/api/getaway/choose) can refuse to make that assumption.
 */
export type VacationIncentiveOutcome =
  | { outcome: 'sent';     message?: string }
  | { outcome: 'rejected'; error: string }
  | { outcome: 'unknown';  error: string };

/** Send a vacation-incentive redemption link via Marketing Boost. */
export async function sendVacationIncentive(opts: {
  destinationId: string;
  name:          string;
  email:         string;
  countrycode?:  string;
  phone?:        string;
  message?:      string;
}): Promise<VacationIncentiveOutcome> {
  // No request was ever made — this is a definitive configuration problem,
  // not an ambiguous transport outcome, so 'rejected' is correct here.
  if (!API_KEY || !SENDER || !BUSINESS_ID) {
    return { outcome: 'rejected', error: 'Marketing Boost not configured (missing API key, sender, or business ID)' };
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
    // A response arrived, but that alone is not proof of anything — see the
    // classification table below. `!res.ok` (a 4xx/5xx status) on its own is
    // NOT sufficient evidence of a definitive rejection: a 5xx or a
    // malformed/truncated body can occur AFTER Marketing Boost has already
    // processed the send, so treating every non-2xx as 'rejected' risks
    // exactly the duplicate-certificate outcome this contract exists to
    // prevent. Only an explicitly parsed `status: false` in the body is
    // definitive proof of rejection, regardless of the HTTP status code.
    //
    // Classification table:
    //   body fails to parse as JSON              -> unknown  (can't prove either way)
    //   parsed, explicit status === false         -> rejected (provider's own definitive answer)
    //   parsed, explicit status === true, res.ok  -> sent
    //   parsed, status is anything else (missing,
    //     not boolean, or status===true w/ !res.ok) -> unknown (ambiguous — no clear proof)
    let json: { status?: unknown; message?: string; errors?: string };
    try {
      json = await res.json() as { status?: unknown; message?: string; errors?: string };
    } catch (parseErr) {
      // 2xx (or any status) but the body couldn't be read/parsed — cannot
      // prove Marketing Boost didn't already process the send.
      return { outcome: 'unknown', error: `response body unreadable: ${String(parseErr)}` };
    }
    if (json.status === false) {
      return { outcome: 'rejected', error: json.errors ?? json.message ?? `HTTP ${res.status}` };
    }
    if (json.status === true && res.ok) {
      return { outcome: 'sent', message: json.message };
    }
    // Anything else — e.g. a 5xx with a parseable-but-inconclusive body, or
    // a 2xx missing the expected `status` field entirely — is ambiguous,
    // not a proven failure.
    return { outcome: 'unknown', error: json.errors ?? json.message ?? `HTTP ${res.status}, inconclusive response body` };
  } catch (err) {
    // fetch threw before any response was read — genuinely ambiguous.
    // Never classify this as 'rejected'.
    return { outcome: 'unknown', error: String(err) };
  }
}

export type HotelSavingsAmount = 100 | 200 | 300 | 500;
export type DiningVoucherAmount = 25 | 50 | 100 | 200;

/** Send a Hotel Savings Card via Marketing Boost. Used for streak/referral milestone rewards. */
export async function sendHotelSavingsCard(opts: {
  fullName: string;
  email:    string;
  amount:   HotelSavingsAmount;
  message?: string;
}): Promise<SendVacationResult> {
  if (!API_KEY || !SENDER || !BUSINESS_ID) {
    return { ok: false, error: 'Marketing Boost not configured (missing API key, sender, or business ID)' };
  }
  try {
    const res = await fetch(`${API_BASE}/hotel_saving_api/send`, {
      method:  'POST',
      headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender:    SENDER,
        business:  BUSINESS_ID,
        full_name: opts.fullName,
        email:     opts.email,
        amount:    opts.amount,
        ...(opts.message ? { message: opts.message } : {}),
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

/** Send a Dining Voucher via Marketing Boost. Used for streak/referral milestone rewards. */
export async function sendDiningVoucher(opts: {
  fullName: string;
  email:    string;
  amount:   DiningVoucherAmount;
  message?: string;
}): Promise<SendVacationResult> {
  if (!API_KEY || !SENDER || !BUSINESS_ID) {
    return { ok: false, error: 'Marketing Boost not configured (missing API key, sender, or business ID)' };
  }
  try {
    const res = await fetch(`${API_BASE}/restaurants_api/send`, {
      method:  'POST',
      headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender:    SENDER,
        business:  BUSINESS_ID,
        full_name: opts.fullName,
        email:     opts.email,
        amount:    opts.amount,
        ...(opts.message ? { message: opts.message } : {}),
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
