/**
 * GET /api/fleet/tax-report?year=YYYY
 * Generates an annual fleet fuel cost PDF for tax / accounting purposes.
 * Fleet plan required.
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { findById }         from '@/lib/users';
import { getFillups, computeMpg } from '@/lib/fillups';
import PDFDocument          from 'pdfkit';

// ── Brand colours (match existing export route) ───────────────────────────────
const NAVY   = '#1e2d4a';
const TEAL   = '#1eb68f';
const AMBER  = '#f59e0b';
const SLATE  = '#475569';
const LIGHT  = '#f8fafc';
const WHITE  = '#ffffff';
const GREEN  = '#16a34a';
const BORDER = '#e2e8f0';

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

export async function GET(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const user   = await findById(userId);

  if (!user || user.plan !== 'fleet') {
    return NextResponse.json(
      { error: 'Annual tax report is a Fleet feature. Upgrade to Fleet to download.', upgrade: true },
      { status: 403 },
    );
  }

  // ── Year param (default: current year) ───────────────────────────────────
  const { searchParams } = new URL(req.url);
  const currentYear = new Date().getFullYear();
  const yearParam   = searchParams.get('year');
  const year        = yearParam ? parseInt(yearParam, 10) : currentYear;

  if (isNaN(year) || year < 2020 || year > currentYear) {
    return NextResponse.json({ error: 'Invalid year.' }, { status: 400 });
  }

  const yearStr  = String(year);
  const allFillups = getFillups(userId).filter((f) => f.date.startsWith(yearStr));

  if (allFillups.length === 0) {
    return NextResponse.json(
      { error: `No fill-up records found for ${year}.` },
      { status: 404 },
    );
  }

  const sorted = [...allFillups].sort((a, b) => a.date.localeCompare(b.date));

  // ── Aggregate data ────────────────────────────────────────────────────────

  // Monthly breakdown
  const monthlyMap = new Map<string, { count: number; gallons: number; spent: number }>();
  for (const f of sorted) {
    const m = f.date.slice(0, 7); // YYYY-MM
    if (!monthlyMap.has(m)) monthlyMap.set(m, { count: 0, gallons: 0, spent: 0 });
    const mo = monthlyMap.get(m)!;
    mo.count++;
    mo.gallons += f.gallonsPumped;
    mo.spent   += f.totalCost;
  }
  const months = [...monthlyMap.keys()].sort();

  // Per-vehicle breakdown
  const vehicleMap = new Map<string, { count: number; gallons: number; spent: number; fills: typeof sorted }>();
  for (const f of sorted) {
    const k = f.vehicleName || 'Unknown Vehicle';
    if (!vehicleMap.has(k)) vehicleMap.set(k, { count: 0, gallons: 0, spent: 0, fills: [] });
    const v = vehicleMap.get(k)!;
    v.count++;
    v.gallons += f.gallonsPumped;
    v.spent   += f.totalCost;
    v.fills.push(f);
  }

  // Totals
  const totalSpent   = sorted.reduce((s, f) => s + f.totalCost, 0);
  const totalGallons = sorted.reduce((s, f) => s + f.gallonsPumped, 0);
  const totalCount   = sorted.length;
  const avgPpg       = totalGallons > 0 ? totalSpent / totalGallons : 0;

  const mpgMap    = computeMpg(sorted);
  const mpgValues = Object.values(mpgMap).filter((v): v is number => v !== null);
  const avgMpg    = mpgValues.length > 0
    ? mpgValues.reduce((s, v) => s + v, 0) / mpgValues.length
    : null;

  // ── Build PDF ─────────────────────────────────────────────────────────────
  const doc = new PDFDocument({
    margin: 50,
    size: 'LETTER',
    info: {
      Title:    `GasCap Fleet Fuel Tax Report — ${year}`,
      Author:   user.name,
      Subject:  `Annual fleet fuel costs for tax year ${year}`,
      Keywords: 'fleet fuel tax report gascap',
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  await new Promise<void>((resolve) => {
    doc.on('end', resolve);

    const pageW    = doc.page.width;
    const pageH    = doc.page.height;
    const margin   = 50;
    const contentW = pageW - margin * 2;
    const genDate  = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    // ── Helper: draw a section heading ──────────────────────────────────────
    function sectionHeading(label: string, y: number): number {
      doc.rect(margin, y, contentW, 20).fill('#f1f5f9');
      doc.rect(margin, y, 3, 20).fill(TEAL);
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9)
         .text(label.toUpperCase(), margin + 10, y + 6, { width: contentW - 10 });
      return y + 28;
    }

    // ── Helper: table header row ────────────────────────────────────────────
    function tableHeader(cols: string[], widths: number[], y: number): number {
      doc.rect(margin, y, contentW, 17).fill(NAVY);
      let cx = margin;
      cols.forEach((h, i) => {
        doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(7.5)
           .text(h, cx + 4, y + 5, { width: widths[i] - 8, align: i > 0 ? 'right' : 'left' });
        cx += widths[i];
      });
      return y + 17;
    }

    // ── Helper: ensure room or add page ────────────────────────────────────
    function ensureRoom(y: number, needed: number): number {
      if (y + needed > pageH - margin) {
        doc.addPage();
        return margin;
      }
      return y;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PAGE 1
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // ── Header band ──────────────────────────────────────────────────────────
    doc.rect(0, 0, pageW, 90).fill(NAVY);

    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(22)
       .text('GasCap', margin, 20, { continued: true });
    doc.fillColor(AMBER).fontSize(12).text('™', { continued: false });

    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(13)
       .text('Annual Fleet Fuel Tax Report', margin, 46);

    doc.fillColor(WHITE).font('Helvetica').fontSize(9)
       .text(`Tax Year ${year}`, margin, 66);

    doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(9)
       .text(`Generated ${genDate}`, 0, 66, { align: 'right', width: pageW - margin });

    // ── Taxpayer info bar ─────────────────────────────────────────────────────
    doc.rect(0, 90, pageW, 30).fill('#f1f5f9');
    doc.fillColor(SLATE).font('Helvetica').fontSize(8.5)
       .text(
         `${user.name}  ·  ${user.email}  ·  Fleet Plan  ·  Tax Year ${year}`,
         margin, 103,
       );

    let y = 138;

    // ── Tax disclaimer box ────────────────────────────────────────────────────
    doc.rect(margin, y, contentW, 36).fillAndStroke('#fffbeb', '#fcd34d');
    doc.fillColor('#92400e').font('Helvetica-Bold').fontSize(7.5)
       .text('TAX NOTICE', margin + 10, y + 7);
    doc.fillColor('#78350f').font('Helvetica').fontSize(7.5)
       .text(
         'This document is provided for informational and record-keeping purposes only and does not constitute ' +
         'tax advice. Consult a qualified tax professional to determine deductibility. ' +
         'Verify all figures against your original receipts.',
         margin + 10, y + 18,
         { width: contentW - 20 },
       );
    y += 50;

    // ── Summary stat boxes ────────────────────────────────────────────────────
    y = sectionHeading('Annual Summary', y);

    const statBoxW = (contentW - 9) / 4;
    const statBoxH = 58;
    const statItems = [
      { label: 'Total Fuel Spend',  value: `$${totalSpent.toFixed(2)}`,       sub: `tax year ${year}` },
      { label: 'Total Gallons',     value: `${totalGallons.toFixed(2)} gal`,   sub: `${totalCount} fill-up${totalCount !== 1 ? 's' : ''}` },
      { label: 'Avg Price / Gallon', value: `$${avgPpg.toFixed(3)}`,           sub: `across all vehicles` },
      { label: 'Fleet Vehicles',    value: String(vehicleMap.size),            sub: `with activity in ${year}` },
    ];

    statItems.forEach((item, i) => {
      const bx = margin + i * (statBoxW + 3);
      doc.rect(bx, y, statBoxW, statBoxH).fillAndStroke(LIGHT, BORDER);
      // Accent bar on top
      doc.rect(bx, y, statBoxW, 3).fill(i === 0 ? TEAL : NAVY);
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16)
         .text(item.value, bx + 8, y + 10, { width: statBoxW - 16 });
      doc.fillColor(SLATE).font('Helvetica-Bold').fontSize(7.5)
         .text(item.label, bx + 8, y + 32, { width: statBoxW - 16 });
      doc.fillColor('#94a3b8').font('Helvetica').fontSize(7)
         .text(item.sub, bx + 8, y + 43, { width: statBoxW - 16 });
    });

    y += statBoxH + 24;

    // ── Monthly breakdown ─────────────────────────────────────────────────────
    y = ensureRoom(y, 17 * (months.length + 3) + 40);
    y = sectionHeading('Monthly Fuel Cost Breakdown', y);

    const mColW = [contentW * 0.30, contentW * 0.17, contentW * 0.17, contentW * 0.18, contentW * 0.18];
    y = tableHeader(['Month', 'Fill-Ups', 'Gallons', 'Avg $/Gal', 'Total Spent'], mColW, y);

    months.forEach((m, ri) => {
      y = ensureRoom(y, 16);
      const mo  = monthlyMap.get(m)!;
      const [my, mm] = m.split('-');
      const label = `${MONTH_NAMES[parseInt(mm, 10) - 1]} ${my}`;
      const avg   = mo.gallons > 0 ? mo.spent / mo.gallons : 0;
      const bg    = ri % 2 === 0 ? WHITE : LIGHT;

      doc.rect(margin, y, contentW, 16).fill(bg);
      const cells = [label, String(mo.count), `${mo.gallons.toFixed(3)}`, `$${avg.toFixed(3)}`, `$${mo.spent.toFixed(2)}`];
      let cx = margin;
      cells.forEach((cell, i) => {
        doc.fillColor(i === 4 ? GREEN : SLATE).font(i === 4 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8)
           .text(cell, cx + 4, y + 4, { width: mColW[i] - 8, align: i > 0 ? 'right' : 'left' });
        cx += mColW[i];
      });
      y += 16;
    });

    // Totals row
    doc.rect(margin, y, contentW, 18).fill('#e2e8f0');
    const totCells = ['TOTAL', String(totalCount), `${totalGallons.toFixed(3)}`, `$${avgPpg.toFixed(3)}`, `$${totalSpent.toFixed(2)}`];
    let cx = margin;
    totCells.forEach((cell, i) => {
      doc.fillColor(i === 4 ? GREEN : NAVY).font('Helvetica-Bold').fontSize(8)
         .text(cell, cx + 4, y + 5, { width: mColW[i] - 8, align: i > 0 ? 'right' : 'left' });
      cx += mColW[i];
    });
    y += 28;

    // ── Per-vehicle breakdown ─────────────────────────────────────────────────
    y = ensureRoom(y, 17 * (vehicleMap.size + 3) + 40);
    y = sectionHeading('Per-Vehicle Breakdown', y);

    const vColW = [contentW * 0.28, contentW * 0.12, contentW * 0.15, contentW * 0.15, contentW * 0.15, contentW * 0.15];
    y = tableHeader(['Vehicle', 'Fill-Ups', 'Gallons', 'Total Spent', 'Avg $/Gal', 'Avg MPG'], vColW, y);

    Array.from(vehicleMap.entries()).forEach(([vName, v], ri) => {
      y = ensureRoom(y, 16);
      const avg    = v.gallons > 0 ? v.spent / v.gallons : 0;
      const vMpg   = computeMpg(v.fills);
      const mpgVals = Object.values(vMpg).filter((x): x is number => x !== null);
      const vAvgMpg = mpgVals.length > 0
        ? (mpgVals.reduce((a, b) => a + b, 0) / mpgVals.length).toFixed(1)
        : 'N/A';
      const bg = ri % 2 === 0 ? WHITE : LIGHT;

      doc.rect(margin, y, contentW, 16).fill(bg);
      const cells = [vName, String(v.count), `${v.gallons.toFixed(3)}`, `$${v.spent.toFixed(2)}`, `$${avg.toFixed(3)}`, String(vAvgMpg)];
      let cx = margin;
      cells.forEach((cell, i) => {
        doc.fillColor(i === 3 ? GREEN : SLATE).font(i === 3 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8)
           .text(cell, cx + 4, y + 4, { width: vColW[i] - 8, align: i > 0 ? 'right' : 'left', ellipsis: true });
        cx += vColW[i];
      });
      y += 16;
    });
    y += 24;

    // ── Full fill-up log ──────────────────────────────────────────────────────
    y = ensureRoom(y, 60);
    y = sectionHeading(`Complete Fill-Up Log — ${year}`, y);

    const tColW   = [contentW*0.10, contentW*0.19, contentW*0.13, contentW*0.10, contentW*0.10, contentW*0.10, contentW*0.10, contentW*0.18];
    const tHeaders = ['Date', 'Vehicle', 'Driver', 'Gallons', '$/Gal', 'Total', 'Odometer', 'Notes'];

    function drawTableHeader(yPos: number): number {
      doc.rect(margin, yPos, contentW, 17).fill(NAVY);
      let cx = margin;
      tHeaders.forEach((h, i) => {
        doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(7)
           .text(h, cx + 3, yPos + 5, { width: tColW[i] - 6, align: i >= 3 && i <= 6 ? 'right' : 'left' });
        cx += tColW[i];
      });
      return yPos + 17;
    }

    y = drawTableHeader(y);

    sorted.forEach((f, ri) => {
      if (y > pageH - margin - 40) {
        doc.addPage();
        y = margin;
        y = drawTableHeader(y);
      }
      const bg = ri % 2 === 0 ? WHITE : LIGHT;
      doc.rect(margin, y, contentW, 14).fill(bg);

      const cells = [
        f.date,
        f.vehicleName,
        f.driverLabel || '—',
        f.gallonsPumped.toFixed(3),
        `$${f.pricePerGallon.toFixed(3)}`,
        `$${f.totalCost.toFixed(2)}`,
        f.odometerReading ? f.odometerReading.toLocaleString() : '—',
        f.notes || '',
      ];
      let cx = margin;
      cells.forEach((cell, i) => {
        doc.fillColor(i === 5 ? GREEN : SLATE).font('Helvetica').fontSize(7)
           .text(cell, cx + 3, y + 4, { width: tColW[i] - 6, ellipsis: true, align: i >= 3 && i <= 6 ? 'right' : 'left' });
        cx += tColW[i];
      });
      y += 14;
    });

    // ── Footer ─────────────────────────────────────────────────────────────────
    const footerY = pageH - 30;
    doc.rect(0, footerY - 8, pageW, 38).fill('#f1f5f9');
    doc.fillColor(SLATE).font('Helvetica').fontSize(7.5)
       .text(
         `GasCap™ Annual Fleet Fuel Tax Report  ·  Tax Year ${year}  ·  ${user.name}  ·  Generated ${genDate}`,
         margin, footerY,
         { align: 'left', width: contentW * 0.7 },
       );
    doc.fillColor(AMBER).font('Helvetica-Bold').fontSize(7.5)
       .text('gascap.app', 0, footerY, { align: 'right', width: pageW - margin });

    doc.end();
  });

  const pdfBuffer = Buffer.concat(chunks);
  const filename  = `gascap-fleet-tax-report-${year}.pdf`;

  return new NextResponse(pdfBuffer, {
    status: 200,
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      String(pdfBuffer.length),
    },
  });
}
