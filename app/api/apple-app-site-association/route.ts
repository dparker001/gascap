import { NextResponse } from 'next/server';

/**
 * Apple App Site Association (AASA) — served at /.well-known/apple-app-site-association
 * via a rewrite in next.config.js. Enables iOS Password AutoFill (iCloud Keychain) inside
 * the Capacitor WKWebView, which is OFF unless the app declares the associated domain.
 *
 * Required for both halves to line up:
 *  - WEB (here): this file lists the app's App ID = <TeamID>.<BundleID>.
 *  - NATIVE (Codemagic/Apple): the app needs the Associated Domains entitlement
 *    `webcredentials:gascap.app` — set in the next build's provisioning/entitlements.
 *
 * Only `webcredentials` (autofill) is declared — NOT `applinks` — so we don't hijack
 * gascap.app URLs into the app (the app already loads the live site directly).
 *
 * Apple fetches this over HTTPS, no redirects, Content-Type application/json.
 */
export const dynamic = 'force-dynamic';

const TEAM_ID   = process.env.APNS_TEAM_ID ?? 'RY86PF6X99';
const BUNDLE_ID = 'app.gascap.ios';

export function GET() {
  return NextResponse.json({
    webcredentials: {
      apps: [`${TEAM_ID}.${BUNDLE_ID}`],
    },
  });
}
