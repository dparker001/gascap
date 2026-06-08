/**
 * Generates PWA icons from the GasCap P/pump logo.
 * Run: node scripts/generate-icons.mjs
 *
 * All P-bowl rings are CLOSED filled annular paths (not stroked arcs)
 * so librsvg / Sharp never implicitly fills any open path.
 */
import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
mkdirSync(publicDir, { recursive: true });

function makeSvg(size, { rounded = true, padFactor = 0.07 } = {}) {
  const ART_W = 100;
  const ART_H = 118;
  const pad   = size * padFactor;
  const s     = Math.min((size - pad * 2) / ART_W, (size - pad * 2) / ART_H);
  const ox    = (size - ART_W * s) / 2;
  const oy    = (size - ART_H * s) / 2;
  // App Store icons must be square (Apple applies its own mask); PWA / maskable /
  // Android adaptive sources keep the rounded look. rounded:false → square corners.
  const r     = rounded ? Math.round(size * 0.18) : 0;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">

  <!-- White background (opaque — App Store icons must have no transparency) -->
  <rect width="${size}" height="${size}" rx="${r}" fill="white"/>

  <g transform="translate(${ox.toFixed(2)},${oy.toFixed(2)}) scale(${s.toFixed(5)})">

    <!-- ─────────────────────────────────────────────────────────────
         P BOWL — concentric filled rings.  Each ring:
           M 41 y1  C Cx y1  Cx y2  41 y2   (outer arc CW)
                    C Ci y2  Ci y1  41 y1   (inner arc CCW)
           Z
         Cx controls band position; same y extents (14–67) for all.
         Midpoint x-reach = 10.25 + 0.75·Cx
         ───────────────────────────────────────────────────────────── -->

    <!-- ① Dark green ring  Cx_outer=97 (x≈83)  Cx_inner=70 (x≈63) -->
    <path d="M 41 14 C 97 14 97 67 41 67 C 70 67 70 14 41 14 Z"
          fill="#005F4A"/>

    <!-- ② Teal ring 1      Cx_outer=70 (x≈63)  Cx_inner=65 (x≈59) -->
    <path d="M 41 14 C 70 14 70 67 41 67 C 65 67 65 14 41 14 Z"
          fill="#1EB68F"/>

    <!-- ③ Teal ring 2      Cx_outer=65 (x≈59)  Cx_inner=60 (x≈55) -->
    <path d="M 41 14 C 65 14 65 67 41 67 C 60 67 60 14 41 14 Z"
          fill="#1EB68F"/>

    <!-- Pump body — covers the left (x=41) edges of all rings -->
    <rect x="22" y="14" width="21" height="67" rx="4" fill="#005F4A"/>

    <!-- Pump window / display screen -->
    <rect x="26" y="25" width="13" height="16" rx="2.5"
          fill="#1EB68F" fill-opacity="0.40"/>

    <!-- Nozzle arm (open path — fill area is tiny and hidden by tip rects) -->
    <g fill="none">
      <path d="M 27 17 Q 19 12 12 8"
            fill="none"
            stroke="#005F4A" stroke-width="7.5" stroke-linecap="round"/>
    </g>

    <!-- Nozzle tip — filled rects, no ambiguity -->
    <rect x="5"  y="4"  width="10" height="10" rx="2.5" fill="#005F4A"/>
    <rect x="11" y="7"  width="7"  height="4.5" rx="2"  fill="#005F4A"/>

    <!-- Connector block -->
    <rect x="41" y="77" width="11" height="7" rx="2" fill="#005F4A"/>

    <!-- Hose curve -->
    <g fill="none">
      <path d="M 31 81 Q 31 98 33 101 Q 37 109 47 109 L 54 109"
            fill="none"
            stroke="#005F4A" stroke-width="9"
            stroke-linecap="round" stroke-linejoin="round"/>
    </g>

  </g>
</svg>`;
}

const sizes = [
  // PWA / web icons (rounded white bg)
  { file: 'icon-192.png',          size: 192 },
  { file: 'icon-512.png',          size: 512 },
  { file: 'apple-touch-icon.png',  size: 180 },

  // Store masters (generated into public/store-icons/ — used by PWABuilder for
  // Android and @capacitor/assets for iOS; they derive every platform size + the
  // Android adaptive icon from these).
  { file: 'store-icons/icon-1024.png',          size: 1024, opts: { rounded: false } }, // App Store master (square, opaque)
  { file: 'store-icons/icon-maskable-1024.png', size: 1024, opts: { padFactor: 0.18 } }, // maskable / adaptive source (safe zone)
  { file: 'store-icons/icon-maskable-512.png',  size: 512,  opts: { padFactor: 0.18 } }, // PWA manifest maskable
];

mkdirSync(join(publicDir, 'store-icons'), { recursive: true });

for (const { file, size, opts } of sizes) {
  const svg = Buffer.from(makeSvg(size, opts));
  await sharp(svg).png().toFile(join(publicDir, file));
  console.log(`✓ ${file}  (${size}×${size})`);
}

console.log('\nAll icons generated successfully (PWA + store masters).');
