/**
 * GET /api/qr?data=<url>&size=600
 *
 * Branded QR code — brand-green modules on white, with the GasCap icon
 * (icon-512.png) composited in the center on a white backing plate for
 * contrast/scan reliability. Replaces the plain black-on-white QR from
 * api.qrserver.com wherever a GasCap QR is shown.
 *
 * High error-correction level (H, ~30% redundancy) is required for a center
 * logo overlay to stay scannable — the logo covers well under that margin.
 */
import { NextResponse } from 'next/server';
import path from 'node:path';
import QRCode from 'qrcode';
import sharp from 'sharp';

const BRAND_DARK = '#005F4A';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const data = searchParams.get('data');
  const size = Math.min(Math.max(Number(searchParams.get('size')) || 400, 100), 1200);
  if (!data) {
    return NextResponse.json({ error: 'Missing data param' }, { status: 400 });
  }

  try {
    const qrBuffer = await QRCode.toBuffer(data, {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: size,
      color: { dark: BRAND_DARK, light: '#FFFFFF' },
    });

    // Logo + white backing plate, sized to stay within the ~30% safe overlay
    // budget that error-correction level H tolerates.
    const logoSize  = Math.round(size * 0.22);
    const plateSize = Math.round(logoSize * 1.35);
    const logoPath  = path.join(process.cwd(), 'public', 'icon-512.png');

    const logo = await sharp(logoPath)
      .resize(logoSize, logoSize, { fit: 'cover' })
      .toBuffer();

    const plate = await sharp({
      create: {
        width: plateSize, height: plateSize, channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite([{ input: logo, gravity: 'center' }])
      .png()
      .toBuffer();

    const branded = await sharp(qrBuffer)
      .composite([{ input: plate, gravity: 'center' }])
      .png()
      .toBuffer();

    return new NextResponse(new Uint8Array(branded), {
      headers: {
        'Content-Type':  'image/png',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (e) {
    console.error('[api/qr] generation failed:', e);
    return NextResponse.json({ error: 'QR generation failed' }, { status: 500 });
  }
}
