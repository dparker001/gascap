import { NextResponse } from 'next/server';

/**
 * Digital Asset Links for the Android TWA (Trusted Web Activity).
 * Served at /.well-known/assetlinks.json via a rewrite in next.config.js.
 *
 * Verifies that www.gascap.app and the Play app share an owner, so the wrapped
 * app runs full-screen with no URL bar. Populate via Railway env once the app is
 * signed:
 *   ANDROID_PACKAGE_NAME  e.g. app.gascap.mobile
 *   GOOGLE_PLAY_SHA256    comma-separated SHA-256 fingerprint(s) from Play
 *                         Console → Setup → App signing (include BOTH the Play
 *                         app-signing key and your upload key).
 *
 * Until the fingerprints are set, this returns valid JSON with an empty list
 * (harmless — the app just keeps the URL bar until verification succeeds).
 */
export const dynamic = 'force-dynamic';

export function GET() {
  const packageName  = process.env.ANDROID_PACKAGE_NAME?.trim() || 'app.gascap.mobile';
  const fingerprints = (process.env.GOOGLE_PLAY_SHA256 ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return NextResponse.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace:                'android_app',
        package_name:             packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ]);
}
