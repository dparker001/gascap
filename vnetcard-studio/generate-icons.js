#!/usr/bin/env node
/**
 * generate-icons.js
 * Generates PWA icon PNGs (192x192 and 512x512) for vNetCard Studio.
 * Uses the `sharp` package from the parent project's node_modules.
 *
 * Run from the vnetcard-studio directory:
 *   node generate-icons.js
 */

const path = require('path');
const fs = require('fs');

// Resolve sharp from the parent project's node_modules
const sharp = require(path.resolve(__dirname, '..', 'node_modules', 'sharp'));

const ICONS_DIR = path.join(__dirname, 'assets', 'icons');

function buildSvg(size) {
  const fontSize = Math.round(size * 0.28);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.1)}" fill="#1A2C5B"/>
  <text
    x="50%" y="54%"
    dominant-baseline="middle"
    text-anchor="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-weight="bold"
    font-size="${fontSize}"
    fill="white"
  >vNC</text>
</svg>`;
}

async function main() {
  // Ensure output directory exists
  fs.mkdirSync(ICONS_DIR, { recursive: true });

  const sizes = [192, 512];

  for (const size of sizes) {
    const svg = buildSvg(size);
    const outPath = path.join(ICONS_DIR, `icon-${size}.png`);
    await sharp(Buffer.from(svg)).png().toFile(outPath);
    const stats = fs.statSync(outPath);
    console.log(`Created ${outPath} (${stats.size} bytes)`);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
