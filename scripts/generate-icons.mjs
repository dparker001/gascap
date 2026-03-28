/**
 * Generates PWA icons from an inline SVG using sharp.
 * Run: node scripts/generate-icons.mjs
 */
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
mkdirSync(publicDir, { recursive: true });

// Inline SVG — scales to any size
function makeSvg(size) {
  const r = Math.round(size * 0.22);
  const u = size / 512;
  // Pump body dims scaled from 512-base design
  const bx = Math.round(128 * u), by = Math.round(96 * u);
  const bw = Math.round(154 * u), bh = Math.round(220 * u);
  const br = Math.round(18 * u);
  const fs = Math.round(size * 0.14); // font size

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <!-- Navy background -->
  <rect width="${size}" height="${size}" rx="${r}" fill="#1e3a5f"/>
  <!-- Amber pump body -->
  <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${br}" fill="#f59e0b"/>
  <!-- Screen window -->
  <rect x="${bx + Math.round(22*u)}" y="${by + Math.round(44*u)}" width="${Math.round(110*u)}" height="${Math.round(62*u)}" rx="${Math.round(10*u)}" fill="#1e3a5f" opacity="0.65"/>
  <!-- Nozzle arm -->
  <path d="M${bx+bw} ${by+Math.round(52*u)} L${Math.round(338*u)} ${by+Math.round(52*u)} Q${Math.round(374*u)} ${by+Math.round(52*u)} ${Math.round(374*u)} ${by+Math.round(88*u)} L${Math.round(374*u)} ${by+Math.round(164*u)} Q${Math.round(374*u)} ${by+Math.round(196*u)} ${Math.round(348*u)} ${by+Math.round(196*u)}"
        fill="none" stroke="#f59e0b" stroke-width="${Math.round(22*u)}" stroke-linecap="round"/>
  <circle cx="${Math.round(346*u)}" cy="${by+Math.round(200*u)}" r="${Math.round(14*u)}" fill="#f59e0b"/>
  <!-- Base -->
  <rect x="${bx}" y="${by+bh+Math.round(8*u)}" width="${bw}" height="${Math.round(40*u)}" rx="${Math.round(10*u)}" fill="#f59e0b"/>
  <!-- GC text -->
  <text x="${size/2}" y="${Math.round(size*0.89)}" font-family="Arial,sans-serif" font-weight="900"
        font-size="${fs}" fill="white" text-anchor="middle">GC</text>
</svg>`;
}

const sizes = [
  { file: 'icon-192.png',        size: 192 },
  { file: 'icon-512.png',        size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
];

for (const { file, size } of sizes) {
  const svg = Buffer.from(makeSvg(size));
  await sharp(svg).png().toFile(join(publicDir, file));
  console.log(`✓ ${file}`);
}

console.log('\nAll PWA icons generated successfully.');
