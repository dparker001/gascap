import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const IRS_RATE = 0.70;

function esc(val: string | null | undefined): string {
  if (val == null) return '';
  const s = String(val);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const uid = (session.user as { id?: string }).id ?? '';

  const { searchParams } = new URL(req.url);
  const year = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()), 10);
  const start = `${year}-01-01`;
  const end   = `${year}-12-31`;

  const [fillups, mileage] = await Promise.all([
    prisma.gigFillup.findMany({
      where:   { userId: uid, date: { gte: start, lte: end } },
      orderBy: { date: 'asc' },
    }),
    prisma.gigMileage.findMany({
      where:   { userId: uid, date: { gte: start, lte: end } },
      orderBy: { date: 'asc' },
    }),
  ]);

  const totalSpend   = fillups.reduce((s, f) => s + f.totalCost, 0);
  const totalGallons = fillups.reduce((s, f) => s + f.gallons, 0);
  const bizMiles     = mileage.filter(m => m.category === 'business').reduce((s, m) => s + m.miles, 0);
  const irsDeduction = bizMiles * IRS_RATE;

  const lines: string[] = [];

  lines.push(`GasCap™ Gig Driver Export — ${year}`);
  lines.push(`Generated: ${new Date().toISOString().slice(0, 10)}`);
  lines.push('');

  // ── Fuel fill-ups ─────────────────────────────────────────────────────────
  lines.push('FUEL FILL-UPS');
  lines.push('Date,Platform,Station,Gallons,Price/Gal,Total Cost');
  if (fillups.length === 0) {
    lines.push('(no fill-ups logged for this year)');
  } else {
    for (const f of fillups) {
      lines.push([
        esc(f.date),
        esc(f.platform?.replace('_', ' ') ?? ''),
        esc(f.station),
        f.gallons.toFixed(3),
        f.pricePerGallon.toFixed(3),
        f.totalCost.toFixed(2),
      ].join(','));
    }
    lines.push(`,,Total,${totalGallons.toFixed(3)},,${ totalSpend.toFixed(2)}`);
  }
  lines.push('');

  // ── Mileage log ───────────────────────────────────────────────────────────
  lines.push('MILEAGE LOG');
  lines.push('Date,Platform,Category,Miles,Start Odometer,End Odometer');
  if (mileage.length === 0) {
    lines.push('(no mileage logged for this year)');
  } else {
    for (const m of mileage) {
      lines.push([
        esc(m.date),
        esc(m.platform?.replace('_', ' ') ?? ''),
        esc(m.category),
        m.miles.toFixed(1),
        m.startOdometer != null ? m.startOdometer.toFixed(0) : '',
        m.endOdometer   != null ? m.endOdometer.toFixed(0)   : '',
      ].join(','));
    }
    const totalMiles = mileage.reduce((s, m) => s + m.miles, 0);
    lines.push(`,,Total,${totalMiles.toFixed(1)},,`);
  }
  lines.push('');

  // ── Summary ───────────────────────────────────────────────────────────────
  lines.push('SUMMARY');
  lines.push(`Total Fuel Spend,$${totalSpend.toFixed(2)}`);
  lines.push(`Total Business Miles,${bizMiles.toFixed(1)}`);
  lines.push(`IRS Standard Mileage Deduction (@ $${IRS_RATE}/mi),$${irsDeduction.toFixed(2)}`);
  lines.push('');
  lines.push('Consult a tax professional for deduction advice.');

  const csv = lines.join('\r\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="gascap-gig-${year}.csv"`,
      'Cache-Control':       'no-store',
    },
  });
}
