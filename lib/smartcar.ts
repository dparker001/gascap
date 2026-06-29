// Smartcar V3 API helpers
//
// V3 flow:
//   1. User authorizes via Smartcar Connect (Application UUID as client_id in URL)
//   2. Callback receives user_id — store on User.smartcarUserId (code is discarded)
//   3. Backend fetches app-level access token via client_credentials grant
//      POST https://iam.smartcar.com/oauth2/token
//      using SMARTCAR_API_CLIENT_ID (client_01KRF...) + SMARTCAR_API_CLIENT_SECRET
//   4. Vehicle API calls use: Authorization: Bearer <appToken> + sc-user-id: <smartcarUserId>
//   5. App token expires in 1hr — fetch fresh as needed (no refresh token)
//
// Credential separation:
//   SMARTCAR_CONNECT_CLIENT_ID  = Application UUID  → used only in Connect OAuth URL
//   SMARTCAR_API_CLIENT_ID      = client_01KRF...   → used for client_credentials token
//   SMARTCAR_API_CLIENT_SECRET  = ...c60e            → paired with API client ID

const CONNECT_BASE  = 'https://connect.smartcar.com';
const IAM_URL       = 'https://iam.smartcar.com/oauth2/token';
const API_URL       = 'https://vehicle.api.smartcar.com/v3/vehicles';

const CONNECT_CLIENT_ID = process.env.SMARTCAR_CONNECT_CLIENT_ID ?? process.env.SMARTCAR_CLIENT_ID ?? '';
const API_CLIENT_ID     = process.env.SMARTCAR_API_CLIENT_ID ?? '';
const API_CLIENT_SECRET = process.env.SMARTCAR_API_CLIENT_SECRET ?? process.env.SMARTCAR_CLIENT_SECRET ?? '';
const REDIRECT_URI      = process.env.SMARTCAR_REDIRECT_URI ?? '';

const SMARTCAR_MODE = process.env.SMARTCAR_MODE ?? (process.env.NODE_ENV === 'production' ? 'live' : 'test');

const SCOPES = [
  'read_vehicle_info',
  'read_odometer',
  'read_fuel',
  'read_battery',
  'read_vin',
].join(' ');

// ─── Helpers ────────────────────────────────────────────────────────────────

function classifyClientId(id: string): 'uuid' | 'client_prefix' | 'missing' {
  if (!id) return 'missing';
  return id.startsWith('client_') ? 'client_prefix' : 'uuid';
}

function safeDiag(step: string, extra: Record<string, unknown> = {}) {
  console.log('[smartcar]', JSON.stringify({
    step,
    endpoint:       extra.endpoint,
    grant_type:     extra.grant_type,
    clientIdType:   extra.clientIdType ?? classifyClientId(extra.clientId as string ?? ''),
    clientIdFirst8: (extra.clientId as string ?? '').slice(0, 8),
    redirectUri:    extra.redirectUri,
    hasSecret:      extra.hasSecret,
    responseStatus: extra.responseStatus,
    smartcarError:  extra.smartcarError,
  }));
}

// Guard: Connect URL must use Application UUID
function assertConnectClientId() {
  const type = classifyClientId(CONNECT_CLIENT_ID);
  if (type === 'missing') throw new Error('Smartcar config error: SMARTCAR_CONNECT_CLIENT_ID is not set.');
  if (type === 'client_prefix') throw new Error('Smartcar config error: Connect URL is using M2M client_id. Set SMARTCAR_CONNECT_CLIENT_ID to the Application UUID.');
}

// Guard: API token must use M2M client_id
function assertApiCredentials() {
  const type = classifyClientId(API_CLIENT_ID);
  if (type === 'missing') throw new Error('Smartcar config error: SMARTCAR_API_CLIENT_ID is not set.');
  if (type === 'uuid') throw new Error('Smartcar config error: client_credentials is using Application UUID instead of M2M client_id. Set SMARTCAR_API_CLIENT_ID to the client_01... value.');
  if (!API_CLIENT_SECRET) throw new Error('Smartcar config error: SMARTCAR_API_CLIENT_SECRET is not set.');
}

// ─── Connect OAuth URL ───────────────────────────────────────────────────────

export function buildConnectUrl(state: string): string {
  assertConnectClientId();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     CONNECT_CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    scope:         SCOPES,
    state,
    mode:          SMARTCAR_MODE,
  });
  safeDiag('buildConnectUrl', {
    clientId: CONNECT_CLIENT_ID,
    clientIdType: classifyClientId(CONNECT_CLIENT_ID),
    redirectUri: REDIRECT_URI,
    hasSecret: false,
  });
  return `${CONNECT_BASE}/oauth/authorize?${params}`;
}

// ─── V3 App-Level Token (client_credentials) ────────────────────────────────

// Fetch a fresh app-level access token. Expires in 1hr — do not cache long-term.
export async function getAppToken(): Promise<string> {
  assertApiCredentials();
  safeDiag('getAppToken:request', {
    endpoint: IAM_URL,
    grant_type: 'client_credentials',
    clientId: API_CLIENT_ID,
    clientIdType: classifyClientId(API_CLIENT_ID),
    hasSecret: !!API_CLIENT_SECRET,
  });

  const res = await fetch(IAM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     API_CLIENT_ID,
      client_secret: API_CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    safeDiag('getAppToken:error', {
      endpoint: IAM_URL,
      grant_type: 'client_credentials',
      clientId: API_CLIENT_ID,
      responseStatus: res.status,
      smartcarError: errorBody,
      hasSecret: !!API_CLIENT_SECRET,
    });
    throw new Error(`Smartcar app token failed: ${res.status} — ${errorBody}`);
  }

  const data = await res.json() as { access_token: string };
  return data.access_token;
}

// ─── Vehicle API (V3 — requires sc-user-id header) ───────────────────────────

async function vehicleGet(path: string, vehicleId: string, appToken: string, smartcarUserId: string) {
  const res = await fetch(`${API_URL}/${vehicleId}${path}`, {
    headers: {
      Authorization: `Bearer ${appToken}`,
      'sc-user-id':  smartcarUserId,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function getVehicleIds(appToken: string, smartcarUserId: string): Promise<string[]> {
  // User vehicles endpoint is still at v2.0 path during Smartcar's v3 transition
  const url = 'https://api.smartcar.com/v2.0/vehicles';
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${appToken}`,
      'sc-user-id':  smartcarUserId,
    },
  });
  const body = await res.text();
  console.log('[smartcar] getVehicleIds response', { status: res.status, body: body.slice(0, 500) });
  if (!res.ok) throw new Error(`Smartcar vehicles list failed: ${res.status}`);
  const data = JSON.parse(body) as { vehicles: string[] };
  return data.vehicles;
}

export async function getVehicleInfo(vehicleId: string, appToken: string, smartcarUserId: string) {
  return vehicleGet('', vehicleId, appToken, smartcarUserId) as Promise<{ make: string; model: string; year: number; id: string } | null>;
}

export async function getOdometer(vehicleId: string, appToken: string, smartcarUserId: string): Promise<{ distance: number } | null> {
  return vehicleGet('/odometer', vehicleId, appToken, smartcarUserId);
}

export async function getFuelLevel(vehicleId: string, appToken: string, smartcarUserId: string): Promise<{ percentRemaining: number; range: number } | null> {
  return vehicleGet('/fuel', vehicleId, appToken, smartcarUserId);
}

export async function getBatteryLevel(vehicleId: string, appToken: string, smartcarUserId: string): Promise<{ percentRemaining: number; range: number } | null> {
  return vehicleGet('/battery', vehicleId, appToken, smartcarUserId);
}

export async function getVin(vehicleId: string, appToken: string, smartcarUserId: string): Promise<{ vin: string } | null> {
  return vehicleGet('/vin', vehicleId, appToken, smartcarUserId);
}

// ─── Safe config export (for /api/debug/smartcar-config) ────────────────────

export function getSmartcarConfigDiag() {
  return {
    connectClientIdType:    classifyClientId(CONNECT_CLIENT_ID),
    connectClientIdFirst8:  CONNECT_CLIENT_ID.slice(0, 8) || 'not_set',
    apiClientIdType:        classifyClientId(API_CLIENT_ID) || 'not_set',
    apiClientIdFirst8:      API_CLIENT_ID.slice(0, 8) || 'not_set',
    hasApiSecret:           !!API_CLIENT_SECRET,
    apiSecretLast4:         API_CLIENT_SECRET.slice(-4) || 'none',
    redirectUri:            REDIRECT_URI,
    smartcarMode:           SMARTCAR_MODE,
    nodeEnv:                process.env.NODE_ENV,
  };
}
