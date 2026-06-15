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

// Known signing-cert SHA-256 fingerprints, baked in so full-screen works without
// depending on a Railway env var. Any GOOGLE_PLAY_SHA256 env values are merged in.
const DEFAULT_FINGERPRINTS = [
  // Play app-signing key — Play re-signs EVERY installed build (testing + production)
  // with this, so it's the one that matters for apps installed from the Play Store.
  'BB:62:85:DE:FD:6B:EE:82:4E:CE:C8:53:6C:19:EB:BE:30:9D:A4:CF:0D:24:30:AD:33:61:83:FA:96:2C:3B:2C',
  // Upload key — used if an APK signed with the upload key is installed directly.
  'E9:B5:14:77:90:ED:51:53:00:B9:38:04:F5:FC:B3:48:A4:CA:35:A2:E5:55:71:DC:37:34:E3:5B:4A:BC:00:7A',
];

export function GET() {
  const packageName = process.env.ANDROID_PACKAGE_NAME?.trim() || 'app.gascap.mobile';
  const envFps = (process.env.GOOGLE_PLAY_SHA256 ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const fingerprints = Array.from(new Set([...DEFAULT_FINGERPRINTS, ...envFps]));

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
