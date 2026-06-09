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
 *   assets/splash.png          2732² — orange mark centered on GasCap green (#005F4A)
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

// Splash — orange mark (~1100²) centered on a 2732² green canvas.
const logo = await sharp(SRC)
  .resize(1100, 1100, { fit: 'inside' })
  .png()
  .toBuffer();

for (const file of ['splash.png', 'splash-dark.png']) {
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: GREEN } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(join(assetsDir, file));
  console.log(`✓ assets/${file} (2732² mark on green)`);
}

console.log('\nCapacitor asset sources generated from the orange brand mark.');
