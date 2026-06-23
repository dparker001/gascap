/**
 * Builds the source images that @capacitor/assets uses to generate the native
 * iOS (and future Android) app icons + splash screens.
 *
 * Source: public/store-icons/source-orange.png — the official ORANGE nozzle+gauge
 * mark on a TRANSPARENT background (the one brand icon; never the old green/teal P).
 *
 * Outputs (committed, consumed by `npx capacitor-assets generate` in CI). Filenames
 * follow the @capacitor/assets convention. Icon + splash share the GasCap green
 * (#005F4A) background so the launch feels cohesive (orange-on-green = brand palette):
 *   assets/icon-only.png       1024² — orange mark on OPAQUE GasCap green (iOS app icon; App Store needs opaque)
 *   assets/icon-foreground.png 1024² — transparent orange mark (Android adaptive fg, future)
 *   assets/icon-background.png 1024² — solid GasCap green (Android adaptive bg, future)
 *   assets/splash.png          2732² — lockup (orange mark + "GasCap™" + tagline) on green
 *   assets/splash-dark.png     2732² — same (dark mode identical)
 *
 * Run: node scripts/generate-capacitor-assets.mjs
 */
import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const root       = join(__dirname, '..');
const SRC        = join(root, 'public', 'store-icons', 'source-orange.png');
const assetsDir  = join(root, 'assets');
const GREEN      = { r: 0, g: 95, b: 74 }; // #005F4A brand green
const BLACK      = { r: 0, g: 0, b: 0 };

mkdirSync(assetsDir, { recursive: true });

// iOS app icon — orange mark filling a 1024² opaque GasCap-green square so it
// matches the splash background (cohesive launch experience).
await sharp(SRC)
  .resize(1024, 1024, { fit: 'cover', position: 'center' })
  .flatten({ background: GREEN })
  .png()
  .toFile(join(assetsDir, 'icon-only.png'));
console.log('✓ assets/icon-only.png (1024² orange on GasCap green)');

// Android adaptive sources (future): transparent mark over solid GasCap green.
await sharp(SRC)
  .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(join(assetsDir, 'icon-foreground.png'));
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: GREEN } })
  .png()
  .toFile(join(assetsDir, 'icon-background.png'));
console.log('✓ assets/icon-foreground.png + icon-background.png');

// Splash — full brand lockup on a 2732² green canvas: orange mark on top, the
// "GasCap™" wordmark, and the "Know before you go" tagline (matches the promo
// video outro). Content is vertically centered so it survives the phone crop.
const SPLASH = 2732;
const MARK   = 760;
const mark = await sharp(SRC).resize(MARK, MARK, { fit: 'inside' }).png().toBuffer();
const lockupSvg = Buffer.from(`
<svg width="${SPLASH}" height="${SPLASH}" xmlns="http://www.w3.org/2000/svg">
  <text x="50%" y="1840" text-anchor="middle"
        font-family="Helvetica, Arial, sans-serif" font-weight="bold"
        font-size="240" letter-spacing="2" fill="#FFFFFF">GasCap<tspan font-size="96" dy="-95">™</tspan></text>
  <text x="50%" y="1980" text-anchor="middle"
        font-family="Helvetica, Arial, sans-serif" font-weight="600"
        font-size="92" fill="#BFE6DB">Know before you go</text>
</svg>`);

for (const file of ['splash.png', 'splash-dark.png']) {
  await sharp({ create: { width: SPLASH, height: SPLASH, channels: 4, background: GREEN } })
    .composite([
      { input: mark, top: 820, left: Math.round((SPLASH - MARK) / 2) },
      { input: lockupSvg, top: 0, left: 0 },
    ])
    .png()
    .toFile(join(assetsDir, file));
  console.log(`✓ assets/${file} (2732² mark + GasCap™ wordmark + tagline on green)`);
}

console.log('\nCapacitor asset sources generated from the orange brand mark.');
