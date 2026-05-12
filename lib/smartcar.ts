/**
 * lib/smartcar.ts — Smartcar SDK helpers
 *
 * Prerequisites (set in Railway env + .env.local):
 *   SMARTCAR_CLIENT_ID     — from dashboard.smartcar.com
 *   SMARTCAR_CLIENT_SECRET — from dashboard.smartcar.com
 *   SMARTCAR_REDIRECT_URI  — must match exactly what's configured in Smartcar dashboard
 *                            production: https://www.gascap.app/api/smartcar/callback
 *                            local dev:  http://localhost:3000/api/smartcar/callback
 *
 * Pricing note: $1.99/connected vehicle/month billed to GasCap (developer account).
 * Gate this feature to Pro users only. 1 linked vehicle per user at MVP.
 */

import * as smartcar from 'smartcar';

export const SCOPES = [
  'read_fuel',       // fuel percentage + range
  'read_odometer',   // odometer reading
  'read_vehicle_info', // make, model, year
  'read_vin',        // VIN for matching to GasCap vehicle
];

// ── AuthClient singleton ──────────────────────────────────────────────────────

let _client: InstanceType<typeof smartcar.AuthClient> | null = null;

function getClient() {
  if (_client) return _client;
  const clientId     = process.env.SMARTCAR_CLIENT_ID;
  const clientSecret = process.env.SMARTCAR_CLIENT_SECRET;
  const redirectUri  = process.env.SMARTCAR_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Smartcar env vars not configured. Set SMARTCAR_CLIENT_ID, SMARTCAR_CLIENT_SECRET, SMARTCAR_REDIRECT_URI.');
  }

  _client = new smartcar.AuthClient({ clientId, clientSecret, redirectUri });
  return _client;
}

// ── OAuth ────────────────────────────────────────────────────────────────────

/**
 * Returns the Smartcar Connect OAuth URL.
 * `state` is typically the user's ID, returned verbatim in the callback.
 */
export function getAuthUrl(state: string): string {
  return getClient().getAuthUrl(SCOPES, { state, forcePrompt: false });
}

/**
 * Exchange an authorization code for access + refresh tokens.
 */
export async function exchangeCode(code: string): Promise<{
  accessToken:  string;
  refreshToken: string;
  expiry:       string;  // ISO timestamp
}> {
  const tokens = await getClient().exchangeCode(code);
  return {
    accessToken:  tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiry:       tokens.expiration?.toISOString() ?? new Date(Date.now() + 7200_000).toISOString(),
  };
}

/**
 * Exchange a refresh token for a new access token.
 * Call this when `smartcarTokenExpiry` is in the past.
 */
export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken:  string;
  refreshToken: string;
  expiry:       string;
}> {
  const tokens = await getClient().exchangeRefreshToken(refreshToken);
  return {
    accessToken:  tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiry:       tokens.expiration?.toISOString() ?? new Date(Date.now() + 7200_000).toISOString(),
  };
}

// ── Vehicle helpers ──────────────────────────────────────────────────────────

export interface SmartcarVehicleInfo {
  id:    string;
  make?: string;
  model?: string;
  year?: number;
  vin?:  string;
}

/**
 * List all Smartcar vehicle IDs for an access token, plus basic info for each.
 */
export async function listVehicles(accessToken: string): Promise<SmartcarVehicleInfo[]> {
  const { vehicles: ids } = await smartcar.getVehicles(accessToken);
  const results: SmartcarVehicleInfo[] = [];

  for (const id of ids) {
    const vehicle = new smartcar.Vehicle(id, accessToken);
    try {
      const [attrs, vinData] = await Promise.allSettled([
        vehicle.attributes(),
        vehicle.vin(),
      ]);
      results.push({
        id,
        make:  attrs.status === 'fulfilled' ? attrs.value.make  : undefined,
        model: attrs.status === 'fulfilled' ? attrs.value.model : undefined,
        year:  attrs.status === 'fulfilled' ? attrs.value.year  : undefined,
        vin:   vinData.status === 'fulfilled' ? vinData.value.vin : undefined,
      });
    } catch {
      results.push({ id });
    }
  }

  return results;
}

// ── Sync data ────────────────────────────────────────────────────────────────

export interface SmartcarSyncResult {
  fuelPercent:  number | null;  // 0–100 (multiply percentRemaining by 100)
  odometer:     number | null;  // miles
  make?:  string;
  model?: string;
  year?:  number;
}

/**
 * Fetch live fuel + odometer from a connected vehicle.
 * The accessToken is assumed to be fresh (call refreshAccessToken first if expired).
 */
export async function syncVehicleData(
  vehicleId:   string,
  accessToken: string,
): Promise<SmartcarSyncResult> {
  const vehicle = new smartcar.Vehicle(vehicleId, accessToken);

  const [fuelRes, odomRes] = await Promise.allSettled([
    vehicle.fuel(),
    vehicle.odometer(),
  ]);

  return {
    fuelPercent: fuelRes.status === 'fulfilled'
      ? Math.round((fuelRes.value.percentRemaining ?? 0) * 100)
      : null,
    odometer: odomRes.status === 'fulfilled'
      ? Math.round(odomRes.value.distance * 0.621371)  // km → miles
      : null,
  };
}

// ── Token freshness ───────────────────────────────────────────────────────────

/**
 * Returns true if the stored access token has expired (or expires within 60s).
 */
export function isTokenExpired(expiry: string | null | undefined): boolean {
  if (!expiry) return true;
  return new Date(expiry).getTime() < Date.now() + 60_000;
}
