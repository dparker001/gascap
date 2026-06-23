/**
 * APNs (Apple Push Notification service) sender for native iOS push.
 *
 * Sends directly to Apple over HTTP/2 using a JWT signed with the APNs Auth Key
 * (.p8). No third-party service. Requires these env vars (set in Railway):
 *   APNS_KEY_ID       — the Key ID of the .p8 key
 *   APNS_TEAM_ID      — your Apple Developer Team ID
 *   APNS_PRIVATE_KEY  — the full .p8 contents (PEM, multi-line is fine)
 *   APNS_BUNDLE_ID    — app bundle id / apns-topic (default app.gascap.ios)
 *
 * Production host (api.push.apple.com) is correct for TestFlight + App Store
 * builds, which use the production APNs environment (matches aps-environment=production).
 */
import http2 from 'node:http2';
import { SignJWT, importPKCS8 } from 'jose';

const KEY_ID      = process.env.APNS_KEY_ID      ?? '';
const TEAM_ID     = process.env.APNS_TEAM_ID     ?? '';
const PRIVATE_KEY = process.env.APNS_PRIVATE_KEY ?? '';
const BUNDLE_ID   = process.env.APNS_BUNDLE_ID   ?? 'app.gascap.ios';
const PROD_HOST    = 'https://api.push.apple.com';
const SANDBOX_HOST = 'https://api.sandbox.push.apple.com';

export function apnsConfigured(): boolean {
  return !!(KEY_ID && TEAM_ID && PRIVATE_KEY);
}

// Apple wants the JWT refreshed at least hourly (and not more than once / 20 min).
let cached: { jwt: string; at: number } | null = null;

async function apnsJwt(): Promise<string> {
  if (cached && Date.now() - cached.at < 50 * 60 * 1000) return cached.jwt;
  const key = await importPKCS8(PRIVATE_KEY.replace(/\\n/g, '\n'), 'ES256');
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: KEY_ID })
    .setIssuer(TEAM_ID)
    .setIssuedAt()
    .sign(key);
  cached = { jwt, at: Date.now() };
  return jwt;
}

export interface ApnsResult { ok: boolean; status?: number; reason?: string }

/**
 * Send a single alert push to one device token. Non-throwing.
 * `data` is merged into the payload alongside `aps` for custom fields (e.g. a deep link).
 */
function sendToHost(host: string, deviceToken: string, jwt: string, payload: string): Promise<ApnsResult> {
  return new Promise<ApnsResult>((resolve) => {
    const client = http2.connect(host);
    const done = (r: ApnsResult) => { try { client.close(); } catch { /* */ } resolve(r); };
    client.on('error', (e) => done({ ok: false, reason: String(e) }));

    const req = client.request({
      ':method':        'POST',
      ':path':          `/3/device/${deviceToken}`,
      'authorization':  `bearer ${jwt}`,
      'apns-topic':     BUNDLE_ID,
      'apns-push-type': 'alert',
      'apns-priority':  '10',
      'content-type':   'application/json',
    });

    let status = 0;
    let respBody = '';
    req.on('response', (h) => { status = Number(h[':status']) || 0; });
    req.on('data', (d) => { respBody += d; });
    req.on('error', (e) => done({ ok: false, reason: String(e) }));
    req.on('end', () => {
      if (status === 200) return done({ ok: true, status });
      let reason = respBody;
      try { reason = (JSON.parse(respBody) as { reason?: string }).reason ?? respBody; } catch { /* */ }
      done({ ok: false, status, reason });
    });

    req.write(payload);
    req.end();
  });
}

export async function sendApns(
  deviceToken: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<ApnsResult> {
  if (!apnsConfigured()) return { ok: false, reason: 'APNs not configured' };

  let jwt: string;
  try { jwt = await apnsJwt(); }
  catch (e) { return { ok: false, reason: `JWT sign failed: ${String(e)}` }; }

  const payload = JSON.stringify({ aps: { alert: { title, body }, sound: 'default' }, ...(data ?? {}) });

  // Token-based (.p8) auth: the PRODUCTION host returns 200 even for a sandbox/dev
  // device token, then silently drops it — so a 200 doesn't prove delivery. A token
  // belongs to exactly one environment, so send to BOTH; the right one delivers, the
  // other harmlessly rejects (BadDeviceToken). Fixes "200 OK but no push received".
  const [prod, sand] = await Promise.all([
    sendToHost(PROD_HOST,    deviceToken, jwt, payload),
    sendToHost(SANDBOX_HOST, deviceToken, jwt, payload),
  ]);

  if (prod.ok || sand.ok) return { ok: true, status: 200 };
  // Neither accepted — surface the more informative reason (prefer the non-token one).
  return (prod.reason && prod.reason !== 'BadDeviceToken') ? prod : sand;
}
