// Smartcar API helpers — OAuth flow + vehicle data fetching

const BASE_URL = 'https://connect.smartcar.com';
const API_URL  = 'https://api.smartcar.com/v2.0';

const CLIENT_ID     = process.env.SMARTCAR_CLIENT_ID!;
const CLIENT_SECRET = process.env.SMARTCAR_CLIENT_SECRET!;
const REDIRECT_URI  = process.env.SMARTCAR_REDIRECT_URI!;

const SCOPES = [
  'read_vehicle_info',
  'read_odometer',
  'read_fuel',
  'read_battery',
  'read_vin',
].join(' ');

// 'test' in local dev (uses Smartcar simulator), 'live' in production
const SMARTCAR_MODE = process.env.SMARTCAR_MODE ?? (process.env.NODE_ENV === 'production' ? 'live' : 'test');

// Build the Smartcar Connect OAuth URL
export function buildConnectUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    scope:         SCOPES,
    state,
    mode:          SMARTCAR_MODE,
  });
  return `${BASE_URL}/oauth/authorize?${params}`;
}

// Exchange auth code for tokens
export async function exchangeCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://auth.smartcar.com/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!res.ok) throw new Error(`Smartcar token exchange failed: ${res.status}`);
  return res.json();
}

// Refresh an expired access token
export async function refreshToken(refresh_token: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://auth.smartcar.com/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token,
    }),
  });
  if (!res.ok) throw new Error(`Smartcar token refresh failed: ${res.status}`);
  return res.json();
}

// Get list of vehicle IDs the user authorized
export async function getVehicleIds(accessToken: string): Promise<string[]> {
  const res = await fetch(`${API_URL}/vehicles`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Smartcar vehicles list failed: ${res.status}`);
  const data = await res.json();
  return data.vehicles as string[];
}

// Get vehicle info (make, model, year)
export async function getVehicleInfo(vehicleId: string, accessToken: string) {
  const res = await fetch(`${API_URL}/vehicles/${vehicleId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Smartcar vehicle info failed: ${res.status}`);
  return res.json() as Promise<{ make: string; model: string; year: number; id: string }>;
}

// Get odometer reading
export async function getOdometer(vehicleId: string, accessToken: string): Promise<{ distance: number } | null> {
  const res = await fetch(`${API_URL}/vehicles/${vehicleId}/odometer`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

// Get fuel tank level (gas vehicles)
export async function getFuelLevel(vehicleId: string, accessToken: string): Promise<{ percentRemaining: number; range: number } | null> {
  const res = await fetch(`${API_URL}/vehicles/${vehicleId}/fuel`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

// Get battery level (EVs)
export async function getBatteryLevel(vehicleId: string, accessToken: string): Promise<{ percentRemaining: number; range: number } | null> {
  const res = await fetch(`${API_URL}/vehicles/${vehicleId}/battery`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

// Get VIN
export async function getVin(vehicleId: string, accessToken: string): Promise<{ vin: string } | null> {
  const res = await fetch(`${API_URL}/vehicles/${vehicleId}/vin`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export function tokenExpiry(expiresIn: number): string {
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}
