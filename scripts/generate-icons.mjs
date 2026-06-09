/**
 * Generates ALL GasCap app icons from the official ORANGE nozzle+gauge brand mark.
 * Source: public/store-icons/source-orange.png — a square neon-orange mark on a
 * TRANSPARENT background.
 *
 * We flatten onto an opaque GasCap-green (#005F4A) background so the icon is
 * fully opaque (the App Store rejects transparency) AND matches the native
 * app icon + splash for a cohesive brand. The browser-tab favicon stays transparent.
 *
 * Run: node scripts/generate-icons.mjs
 *
 * NOTE: The old green/teal "P / pump" mark is retired — never regenerate it.
 * To change the icon, replace source-orange.png (square) and re-run.
 * (The in-app header logo public/gascap-icon-raw.png is a SEPARATE transparent
 *  orange mark and is intentionally NOT regenerated here.)
 */
import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const SRC       = join(publicDir, 'store-icons', 'source-orange.png');

mkdirSync(join(publicDir, 'store-icons'), { recursive: true });

async function writeIcon(file, size, opaque = true) {
  let img = sharp(SRC).resize(size, size, { fit: 'cover', position: 'center' });
  // Opaque GasCap green (#005F4A) for store/home-screen icons — matches the native
  // app icon + splash. (App Store rejects transparency.) The browser-tab favicon
  // stays transparent so it looks right on the tab strip.
  if (opaque) img = img.flatten({ background: { r: 0, g: 95, b: 74 } });
  await img.png().toFile(join(publicDir, file));
  console.log(`✓ ${file}  (${size}×${size})${opaque ? '' : '  [transparent]'}`);
}

const targets = [
  // Store masters — PWABuilder (Android) + @capacitor/assets (iOS) derive every
  // platform size, including the Android adaptive icon, from these. Opaque.
  { file: 'store-icons/icon-1024.png',          size: 1024 }, // App Store / Play master
  { file: 'store-icons/icon-maskable-1024.png', size: 1024 }, // maskable / adaptive source
  { file: 'store-icons/icon-maskable-512.png',  size: 512  },

  // PWA / home-screen icons (opaque — these become home-screen app icons)
  { file: 'icon-192.png',          size: 192 },
  { file: 'icon-512.png',          size: 512 },
  { file: 'apple-touch-icon.png',  size: 180 },

  // Browser-tab favicon — TRANSPARENT (a black square looks wrong on the tab strip)
  { file: 'favicon.png',           size: 48, opaque: false },
];

for (const { file, size, opaque } of targets) {
  await writeIcon(file, size, opaque);
}

console.log('\nAll icons generated from the orange-on-green brand mark.');
