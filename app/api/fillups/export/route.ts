/**
 * GET /api/fillups/export
 * Generates a PDF fuel cost report for the signed-in user.
 * Pro plan required. Returns application/pdf stream.
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { findById }         from '@/lib/users';
import { getFillups, computeMpg, getFillupStats } from '@/lib/fillups';
import PDFDocument          from 'pdfkit';

// Colors
const NAVY   = '#1e2d4a';
const AMBER  = '#f59e0b';
const SLATE  = '#475569';
const LIGHT  = '#f8fafc';
const WHITE  = '#ffffff';
const GREEN  = '#16a34a';

async function checkAccess() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { ok: false, status: 401, user: null, userId: '' };
  // Mirror exactly the same userId derivation used in /api/fillups/route.ts
  const userId = session.user.id ?? session.user.email ?? '';
  const user   = findById(userId);
  if (!user || user.plan === 'free') return { ok: false, status: 403, user, userId };
  return { ok: true, status: 200, user: user!, userId };
}

// HEAD — lightweight pre-flight check: plan access + data existence
export async function HEAD() {
  const { ok, status, userId } = await checkAccess();
  if (!ok) return new NextResponse(null, { status });
  const count = getFillups(userId).length;
  return new NextResponse(null, { status: count > 0 ? 200 : 404 });
}

export async function GET(req: Request) {
  const { ok, status, user, userId } = await checkAccess();
  if (!ok || !user) {
    if (status === 401) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json(
      { error: 'PDF export is a Pro feature. Upgrade to download your fuel report.', upgrade: true },
      { status: 403 },
    );
  }

  // Read query params for optional date range
  const { searchParams } = new URL(req.url);
  const fromDate = searchParams.get('from') ?? undefined;
  const toDate   = searchParams.get('to')   ?? undefined;

  // Fetch data — use the same userId key that was stored when fillups were saved
  let fillups = getFillups(userId);
  if (fromDate) fillups = fillups.filter((f) => f.date >= fromDate);
  if (toDate)   fillups = fillups.filter((f) => f.date <= toDate);
  // Sort oldest-first for the table
  const sorted = [...fillups].sort((a, b) => a.date.localeCompare(b.date));

  if (fillups.length === 0) {
    return NextResponse.json({ error: 'No fill-ups found to export.' }, { status: 404 });
  }

  const mpgMap = computeMpg(fillups);
  const stats  = getFillupStats(fillups, mpgMap);

  // Group by vehicle
  const byVehicle = new Map<string, typeof sorted>();
  for (const f of sorted) {
    const key = f.vehicleName || 'Unknown Vehicle';
    if (!byVehicle.has(key)) byVehicle.set(key, []);
    byVehicle.get(key)!.push(f);
  }

  // Build PDF
  const doc = new PDFDocument({ margin: 50, size: 'LETTER', info: { Title: 'GasCap Fuel Report', Author: user.name } });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  await new Promise<void>((resolve) => {
    doc.on('end', resolve);

    const pageW    = doc.page.width;
    const pageH    = doc.page.height;
    const margin   = 50;
    const contentW = pageW - margin * 2;
    const now      = new Date();
    const dateStr  = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // ── Header band ──────────────────────────────────────────────────────
    doc.rect(0, 0, pageW, 80).fill(NAVY);

    // Brand name
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(22).text('GasCap', margin, 22, { continued: true });
    doc.fillColor(AMBER).fontSize(12).text('™', { continued: false });

    // Report title
    doc.fillColor(WHITE).font('Helvetica').fontSize(11)
       .text('Fuel Cost Report', margin, 50);

    // Date top-right
    doc.fillColor(WHITE).font('Helvetica').fontSize(9)
       .text(dateStr, 0, 30, { align: 'right', width: pageW - margin });

    // ── User info bar ────────────────────────────────────────────────────
    doc.rect(0, 80, pageW, 32).fill('#f1f5f9');
    doc.fillColor(SLATE).font('Helvetica').fontSize(9)
       .text(`${user.name}  ·  ${user.email}  ·  ${user.plan.charAt(0).toUpperCase() + user.plan.slice(1)} Plan`, margin, 91);

    let y = 130;

    // ── Summary stats ────────────────────────────────────────────────────
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text('Summary', margin, y);
    y += 20;

    const statBoxW = (contentW - 9) / 4;  // 4 boxes with 3px gaps
    const statBoxH = 56;
    const statItems = [
      { label: 'Total Fill-Ups',   value: String(stats.count) },
      { label: 'Total Spent',      value: `$${stats.totalSpent.toFixed(2)}` },
      { label: 'Total Gallons',    value: `${stats.totalGallons.toFixed(1)} gal` },
      { label: 'Average MPG',      value: stats.avgMpg ? `${stats.avgMpg.toFixed(1)}` : 'N/A' },
    ];

    statItems.forEach((item, i) => {
      const bx = margin + i * (statBoxW + 3);
      doc.rect(bx, y, statBoxW, statBoxH).fillAndStroke(LIGHT, '#e2e8f0');
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(18)
         .text(item.value, bx + 8, y + 8, { width: statBoxW - 16 });
      doc.fillColor(SLATE).font('Helvetica').fontSize(8)
         .text(item.label, bx + 8, y + statBoxH - 18, { width: statBoxW - 16 });
    });

    y += statBoxH + 24;

    // ── Per-vehicle breakdown ─────────────────────────────────────────────
    if (byVehicle.size > 1) {
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text('By Vehicle', margin, y);
      y += 18;

      const colW = [contentW * 0.35, contentW * 0.13, contentW * 0.14, contentW * 0.14, contentW * 0.12, contentW * 0.12];
      const headers = ['Vehicle', 'Fill-Ups', 'Total Spent', 'Avg $/Gal', 'Total Gal', 'Avg MPG'];

      // Header row
      doc.rect(margin, y, contentW, 18).fill('#1e2d4a');
      let cx = margin;
      headers.forEach((h, i) => {
        doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(8)
           .text(h, cx + 4, y + 5, { width: colW[i] - 8 });
        cx += colW[i];
      });
      y += 18;

      Array.from(byVehicle.entries()).forEach(([vName, vFills], ri) => {
        const vSpent   = vFills.reduce((s, f) => s + f.totalCost, 0);
        const vGallons = vFills.reduce((s, f) => s + f.gallonsPumped, 0);
        const vAvgPpg  = vGallons > 0 ? vSpent / vGallons : 0;
        const vMpgMap  = computeMpg(vFills);
        const vMpgVals = Object.values(vMpgMap).filter((v): v is number => v !== null);
        const vAvgMpg  = vMpgVals.length > 0 ? (vMpgVals.reduce((a, b) => a + b, 0) / vMpgVals.length).toFixed(1) : 'N/A';
        const bg       = ri % 2 === 0 ? WHITE : '#f8fafc';

        doc.rect(margin, y, contentW, 16).fill(bg);
        const row = [vName, String(vFills.length), `$${vSpent.toFixed(2)}`, `$${vAvgPpg.toFixed(3)}`, `${vGallons.toFixed(1)}`, String(vAvgMpg)];
        cx = margin;
        row.forEach((cell, i) => {
          doc.fillColor(SLATE).font('Helvetica').fontSize(8)
             .text(cell, cx + 4, y + 4, { width: colW[i] - 8, ellipsis: true });
          cx += colW[i];
        });
        y += 16;
      });
      y += 20;
    }

    // ── Fillup detail table ───────────────────────────────────────────────
    // Check if we need a new page
    if (y > pageH - 200) { doc.addPage(); y = margin; }

    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text('Fill-Up Log', margin, y);
    if (fromDate || toDate) {
      doc.fillColor(SLATE).font('Helvetica').fontSize(9)
         .text(`${fromDate ?? 'All time'} → ${toDate ?? 'today'}`, margin + 80, y + 2);
    }
    y += 20;

    const tColW   = [contentW * 0.11, contentW * 0.22, contentW * 0.10, contentW * 0.11, contentW * 0.11, contentW * 0.11, contentW * 0.24];
    const tHeaders = ['Date', 'Vehicle', 'Gallons', '$/Gal', 'Total', 'Odometer', 'Notes'];

    // Table header
    doc.rect(margin, y, contentW, 18).fill(NAVY);
    let cx = margin;
    tHeaders.forEach((h, i) => {
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(7.5)
         .text(h, cx + 3, y + 5, { width: tColW[i] - 6 });
      cx += tColW[i];
    });
    y += 18;

    for (const f of sorted) {
      // New page if needed
      if (y > pageH - 80) {
        doc.addPage();
        y = margin;
        // Re-draw header on new page
        doc.rect(margin, y, contentW, 18).fill(NAVY);
        cx = margin;
        tHeaders.forEach((h, i) => {
          doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(7.5)
             .text(h, cx + 3, y + 5, { width: tColW[i] - 6 });
          cx += tColW[i];
        });
        y += 18;
      }

      const rowIdx = sorted.indexOf(f);
      const bg     = rowIdx % 2 === 0 ? WHITE : '#f8fafc';
      doc.rect(margin, y, contentW, 15).fill(bg);

      const row = [
        f.date,
        f.vehicleName,
        `${f.gallonsPumped.toFixed(3)}`,
        `$${f.pricePerGallon.toFixed(3)}`,
        `$${f.totalCost.toFixed(2)}`,
        f.odometerReading ? f.odometerReading.toLocaleString() : '—',
        f.notes || '',
      ];
      cx = margin;
      row.forEach((cell, i) => {
        doc.fillColor(i === 4 ? GREEN : SLATE).font('Helvetica').fontSize(7.5)
           .text(cell, cx + 3, y + 4, { width: tColW[i] - 6, ellipsis: true });
        cx += tColW[i];
      });
      y += 15;
    }

    // ── Footer ────────────────────────────────────────────────────────────
    const footerY = pageH - 30;
    doc.rect(0, footerY - 8, pageW, 38).fill('#f1f5f9');
    doc.fillColor(SLATE).font('Helvetica').fontSize(8)
       .text(`Generated by GasCap™  ·  ${dateStr}  ·  ${user.name}`, margin, footerY, { align: 'left' });
    doc.fillColor(AMBER).font('Helvetica-Bold').fontSize(8)
       .text('gascap.app', 0, footerY, { align: 'right', width: pageW - margin });

    doc.end();
  });

  const pdfBuffer = Buffer.concat(chunks);
  const filename  = `gascap-fuel-report-${new Date().toISOString().split('T')[0]}.pdf`;

  return new NextResponse(pdfBuffer, {
    status: 200,
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      String(pdfBuffer.length),
    },
  });
}
