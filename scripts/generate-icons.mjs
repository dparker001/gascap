/**
 * Generates PWA icons from the GasCap P/pump logo.
 * Run: node scripts/generate-icons.mjs
 *
 * Produces:
 *   public/icon-192.png       — Android home screen / PWA manifest
 *   public/icon-512.png       — PWA splash / store listing
 *   public/apple-touch-icon.png — iOS home screen (180×180)
 */
import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
mkdirSync(publicDir, { recursive: true });

/**
 * Build the GasCap P/pump logo SVG at a given pixel size.
 * Uses a white background so it renders correctly on home screens.
 * The icon coordinates are defined in a 100×116 space and scaled to `size`.
 */
function makeSvg(size) {
  const s = size / 110; // scale factor (a little padding on each side)
  const r = Math.round(size * 0.18); // rounded corner radius for background

  // Helper: scale a coordinate value
  const x = (v) => (v * s).toFixed(2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <!-- White background with soft rounded corners -->
  <rect width="${size}" height="${size}" rx="${r}" fill="white"/>

  <!-- Centre the 100×116 artwork: offset by ~5px each side -->
  <g transform="translate(${(size - 100 * s) / 2}, ${(size - 116 * s) / 2}) scale(${s.toFixed(4)})">

    <!-- Outer P bowl — dark forest green -->
    <path d="M 40 20 C 96 20 96 69 40 69"
          stroke="#005F4A" stroke-width="11" stroke-linecap="round" fill="none"/>

    <!-- Inner teal accent arcs -->
    <path d="M 40 31 C 80 31 80 58 40 58"
          stroke="#1EB68F" stroke-width="7" stroke-linecap="round" fill="none"/>
    <path d="M 40 40 C 68 40 68 49 40 49"
          stroke="#1EB68F" stroke-width="5.5" stroke-linecap="round" fill="none"/>

    <!-- Pump body — P vertical stem -->
    <rect x="23" y="19" width="19" height="60" rx="4" fill="#005F4A"/>

    <!-- Pump window (teal tint) -->
    <rect x="27" y="29" width="11" height="15" rx="2" fill="#1EB68F" opacity="0.45"/>

    <!-- Nozzle arm extending upper-left -->
    <path d="M 27 21 Q 19 16 11 11"
          stroke="#005F4A" stroke-width="7.5" stroke-linecap="round" fill="none"/>

    <!-- Nozzle head -->
    <rect x="5"   y="7"   width="9"  height="10" rx="2.5" fill="#005F4A"/>
    <rect x="11"  y="9.5" width="7"  height="5"  rx="2"   fill="#005F4A"/>

    <!-- Connector block at base of stem -->
    <rect x="40" y="75" width="11" height="7" rx="2" fill="#005F4A"/>

    <!-- Hose curve at bottom of P -->
    <path d="M 31 79 Q 31 96 33 99 Q 37 106 46 106 L 52 106"
          stroke="#005F4A" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>

  </g>
</svg>`;
}

const sizes = [
  { file: 'icon-192.png',         size: 192 },
  { file: 'icon-512.png',         size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
];

for (const { file, size } of sizes) {
  const svg = Buffer.from(makeSvg(size));
  await sharp(svg).png().toFile(join(publicDir, file));
  console.log(`✓ ${file}  (${size}×${size})`);
}

console.log('\nAll PWA icons generated successfully.');
