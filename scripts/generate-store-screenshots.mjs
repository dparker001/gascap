/**
 * Turns raw app captures into polished store screenshots:
 * brand-gradient background + headline caption + the framed app screen.
 * Outputs Apple (1290×2796) and Play (1080×2160) sets.
 *
 * Raw captures live in public/store-screenshots/ (1290×2796 iPhone shots).
 * Run: node scripts/generate-store-screenshots.mjs
 */
import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, '..', 'public', 'store-screenshots');

const GREEN = '#005F4A', TEAL = '#1EB68F';

const SHOTS = [
  { src: 'www.gascap.app_(iPhone 14 Pro Max).png',     name: '01-know-before-you-go', lines: ['Know before', 'you go'],            sub: 'Your exact fill-up, figured out.' },
  { src: 'www.gascap.app_(iPhone 14 Pro Max) (1).png', name: '02-exact-cost',         lines: ['Know your cost', 'before you pump'], sub: 'No guessing. No overpaying.' },
  { src: 'www.gascap.app_(iPhone 14 Pro Max) (2).png', name: '03-rental-mode',        lines: ['Skip the rental', 'refuel fee'],     sub: 'Return it at the right fuel level.' },
  { src: 'www.gascap.app_(iPhone 14 Pro Max) (3).png', name: '04-track-fillups',      lines: ['Track every', 'fill-up & MPG'],      sub: 'See your real fuel costs over time.' },
  // No price/"free" words in store captions — Apple 2.3.7 treats "free"/"discounted"
  // as a price reference in metadata. Describe the feature, not the price.
  { src: 'www.gascap.app_(iPhone 14 Pro Max) (4).png', name: '05-monthly-giveaway',   lines: ['Win a gas card', 'every month'],     sub: 'A monthly giveaway for drivers.' },
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function roundCorners(buf, w, h, r) {
  const mask = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`);
  return sharp(buf).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

async function makeShot(shot, W, H, outDir) {
  const { src, name, lines, sub } = shot;

  const bg = Buffer.from(`<svg width="${W}" height="${H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${GREEN}"/><stop offset="1" stop-color="${TEAL}"/>
    </linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/></svg>`);

  const padTop  = Math.round(H * 0.055);
  const hSize   = Math.round(W * 0.072);
  const subSize = Math.round(W * 0.034);
  const lineH   = Math.round(hSize * 1.12);

  const headTexts = lines
    .map((l, i) => `<text x="50%" y="${padTop + hSize + i * lineH}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="${hSize}" fill="#ffffff">${esc(l)}</text>`)
    .join('');
  const subY  = padTop + hSize + lines.length * lineH + Math.round(subSize * 0.6);
  const subTx = `<text x="50%" y="${subY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${subSize}" fill="#d7f5ec">${esc(sub)}</text>`;
  const textSvg = Buffer.from(`<svg width="${W}" height="${H}">${headTexts}${subTx}</svg>`);

  const headBottom = subY + Math.round(subSize * 0.8);
  const availH = H - headBottom - Math.round(H * 0.04);

  const meta = await sharp(join(dir, src)).metadata();
  const ar = meta.width / meta.height;
  let sh = availH, sw = Math.round(sh * ar);
  const maxW = Math.round(W * 0.82);
  if (sw > maxW) { sw = maxW; sh = Math.round(sw / ar); }

  const resized = await sharp(join(dir, src)).resize(sw, sh).toBuffer();
  const r = Math.round(sw * 0.045);
  const framed = await roundCorners(resized, sw, sh, r);

  const sx = Math.round((W - sw) / 2);
  const sy = headBottom + Math.round((availH - sh) / 2);

  const shadow = await sharp(Buffer.from(`<svg width="${sw}" height="${sh}"><rect width="${sw}" height="${sh}" rx="${r}" fill="#00000088"/></svg>`))
    .blur(26).png().toBuffer();

  mkdirSync(outDir, { recursive: true });
  await sharp(bg)
    .composite([
      { input: textSvg, top: 0, left: 0 },
      { input: shadow,  top: sy + 16, left: sx },
      { input: framed,  top: sy,      left: sx },
    ])
    .png()
    .toFile(join(outDir, `${name}.png`));
  console.log(`✓ ${outDir.split('/').pop()}/${name}.png  (${W}×${H})`);
}

for (const s of SHOTS) {
  await makeShot(s, 1290, 2796, join(dir, 'final', 'apple'));
  await makeShot(s, 1080, 2160, join(dir, 'final', 'play'));
  // 13-inch iPad (App Store requires this set for universal builds). The phone-shaped
  // app screen is centered on the brand canvas — standard for phone-first apps.
  await makeShot(s, 2048, 2732, join(dir, 'final', 'ipad'));
}
console.log('\nStore screenshots generated (Apple 1290×2796 + Play 1080×2160 + iPad 2048×2732).');
