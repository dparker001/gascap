/**
 * Generates ALL GasCap app icons from the official ORANGE nozzle+gauge brand mark.
 * Source: public/store-icons/source-orange.png (transparent PNG).
 * Background: solid white (opaque — required for the App Store icon).
 *
 * Run: node scripts/generate-icons.mjs
 *
 * NOTE: The old green/teal "P / pump" mark is retired — never regenerate it.
 * To change the icon, replace source-orange.png and re-run this script.
 */
import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const SRC       = join(publicDir, 'store-icons', 'source-orange.png');

mkdirSync(join(publicDir, 'store-icons'), { recursive: true });

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };   // opaque white background

/**
 * Composite the orange mark, centered with padding, onto a white square.
 * padFactor leaves margin around the mark (larger for maskable safe-zones).
 */
async function writeIcon(file, size, padFactor) {
  const pad   = Math.round(size * padFactor);
  const inner = size - pad * 2;
  const mark  = await sharp(SRC)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toFile(join(publicDir, file));
  console.log(`✓ ${file}  (${size}×${size})`);
}

const targets = [
  // Store masters — PWABuilder (Android) + @capacitor/assets (iOS) derive every
  // platform size, including the Android adaptive icon, from these.
  { file: 'store-icons/icon-1024.png',          size: 1024, pad: 0.12 }, // App Store / Play master
  { file: 'store-icons/icon-maskable-1024.png', size: 1024, pad: 0.20 }, // maskable / adaptive source (safe zone)
  { file: 'store-icons/icon-maskable-512.png',  size: 512,  pad: 0.20 },

  // PWA / web icons (referenced by manifest + <head>)
  { file: 'icon-192.png',          size: 192, pad: 0.16 },
  { file: 'icon-512.png',          size: 512, pad: 0.16 },
  { file: 'apple-touch-icon.png',  size: 180, pad: 0.12 },
  { file: 'favicon.png',           size: 48,  pad: 0.10 },
];

for (const { file, size, pad } of targets) {
  await writeIcon(file, size, pad);
}

console.log('\nAll icons generated from the orange brand mark (white background).');
