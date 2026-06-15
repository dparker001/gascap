import sharp from 'sharp';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const svg = `<svg width="1024" height="500" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#005F4A"/><stop offset="1" stop-color="#1EB68F"/></linearGradient></defs>
  <rect width="1024" height="500" fill="url(#g)"/>
  <text x="512" y="232" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="112">
    <tspan fill="#ffffff">Gas</tspan><tspan fill="#FA7109">Cap</tspan><tspan fill="#d7f5ec" font-size="42" dy="-42">TM</tspan>
  </text>
  <text x="512" y="322" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="42" fill="#ffffff">Know before you go</text>
  <text x="512" y="372" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="27" fill="#d7f5ec">Free gas cost calculator &#183; real local prices</text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(join(root, 'public/store-screenshots/final/play-feature-graphic.png'));
console.log('✓ play-feature-graphic.png (1024x500) regenerated');
