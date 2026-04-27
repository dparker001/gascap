/**
 * POST /api/vehicles/import
 * Bulk-import vehicles from a CSV file. Fleet plan required.
 *
 * Expected CSV columns (header row required, order flexible):
 *   Name*         — vehicle display name (required)
 *   Tank Size*    — tank capacity in gallons (required)  [aliases: Gallons, Tank, Capacity]
 *   Year          — model year (optional)
 *   Make          — manufacturer (optional)
 *   Model         — model name (optional)
 *   Trim          — trim level (optional)
 *   VIN           — 17-char VIN (optional)
 *   Odometer      — current odometer reading in miles (optional)
 *
 * Returns:
 *   { created: number, skipped: number, rows: ImportRow[] }
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { findById }         from '@/lib/users';
import { addVehicle }       from '@/lib/savedVehicles';

const MAX_ROWS    = 200; // hard cap per import
const MAX_FILE_MB = 1;

// ── CSV parser ────────────────────────────────────────────────────────────────
// Handles quoted fields (including commas and newlines inside quotes), CRLF/LF.

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let col  = '';
  let row: string[] = [];
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch   = text[i];
    const next = text[i + 1];

    if (inQuote) {
      if (ch === '"' && next === '"') { col += '"'; i++; }   // escaped quote
      else if (ch === '"')            { inQuote = false; }   // closing quote
      else                            { col += ch; }
    } else {
      if      (ch === '"')                         { inQuote = true; }
      else if (ch === ',')                         { row.push(col); col = ''; }
      else if (ch === '\r' && next === '\n')       { row.push(col); col = ''; rows.push(row); row = []; i++; }
      else if (ch === '\n' || ch === '\r')         { row.push(col); col = ''; rows.push(row); row = []; }
      else                                         { col += ch; }
    }
  }
  row.push(col);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

// ── Column aliasing ───────────────────────────────────────────────────────────

function normalise(s: string) { return s.trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }

const COL_ALIASES: Record<string, string[]> = {
  name:     ['name', 'vehicle', 'vehiclename', 'nickname', 'label'],
  gallons:  ['tanksize', 'gallons', 'tank', 'capacity', 'tankcapacitygal', 'tanksizegal'],
  year:     ['year', 'modelyear', 'yr'],
  make:     ['make', 'manufacturer', 'brand'],
  model:    ['model', 'modelname'],
  trim:     ['trim', 'trimlevel', 'variant'],
  vin:      ['vin', 'vincode', 'vehicleidentificationnumber'],
  odometer: ['odometer', 'currentodometer', 'miles', 'mileage', 'odo'],
};

function mapHeaders(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    const n = normalise(h);
    for (const [field, aliases] of Object.entries(COL_ALIASES)) {
      if (aliases.includes(n) && !(field in map)) map[field] = i;
    }
  });
  return map;
}

// ── Row result type ───────────────────────────────────────────────────────────

export interface ImportRow {
  row:    number;
  name:   string;
  status: 'created' | 'skipped';
  error?: string;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // Auth
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const user   = await findById(userId);

  if (!user || user.plan !== 'fleet') {
    return NextResponse.json(
      { error: 'Bulk vehicle import is a Fleet feature. Upgrade to Fleet to use it.', upgrade: true },
      { status: 403 },
    );
  }

  // Parse multipart
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid request — expected multipart/form-data.' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith('.csv')) {
    return NextResponse.json({ error: 'File must be a .csv file.' }, { status: 400 });
  }

  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    return NextResponse.json({ error: `File too large — max ${MAX_FILE_MB} MB.` }, { status: 400 });
  }

  const text = await file.text();
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim()));

  if (rows.length < 2) {
    return NextResponse.json({ error: 'CSV must have a header row and at least one data row.' }, { status: 400 });
  }

  const headers = rows[0];
  const colMap  = mapHeaders(headers);

  if (!('name' in colMap)) {
    return NextResponse.json({ error: 'CSV is missing a "Name" column.' }, { status: 400 });
  }
  if (!('gallons' in colMap)) {
    return NextResponse.json(
      { error: 'CSV is missing a "Tank Size" (gallons) column.' },
      { status: 400 },
    );
  }

  const dataRows = rows.slice(1, MAX_ROWS + 1);

  if (rows.length - 1 > MAX_ROWS) {
    return NextResponse.json(
      { error: `Too many rows — maximum is ${MAX_ROWS} vehicles per import.` },
      { status: 400 },
    );
  }

  // Process rows
  const results: ImportRow[] = [];
  let created = 0;
  let skipped = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const r       = dataRows[i];
    const rowNum  = i + 2; // 1-indexed, accounting for header
    const get     = (field: string) => (colMap[field] !== undefined ? (r[colMap[field]] ?? '').trim() : '');

    const name    = get('name');
    const galStr  = get('gallons');
    const gallons = parseFloat(galStr);

    if (!name) {
      results.push({ row: rowNum, name: `(row ${rowNum})`, status: 'skipped', error: 'Name is empty — row skipped.' });
      skipped++;
      continue;
    }

    if (!galStr || isNaN(gallons) || gallons <= 0 || gallons > 300) {
      results.push({ row: rowNum, name, status: 'skipped', error: `Invalid tank size "${galStr}" — must be a number between 1 and 300.` });
      skipped++;
      continue;
    }

    const year  = get('year')  || undefined;
    const make  = get('make')  || undefined;
    const model = get('model') || undefined;
    const trim  = get('trim')  || undefined;
    const vin   = get('vin')   ? get('vin').toUpperCase() : undefined;
    const odoRaw = get('odometer');
    const odometer = odoRaw ? parseInt(odoRaw.replace(/,/g, ''), 10) : undefined;

    // Basic VIN length check
    if (vin && vin.length !== 17) {
      results.push({ row: rowNum, name, status: 'skipped', error: `VIN "${vin}" must be exactly 17 characters.` });
      skipped++;
      continue;
    }

    try {
      await addVehicle(userId, name, gallons, { year, make, model, trim, vin, currentOdometer: odometer });
      results.push({ row: rowNum, name, status: 'created' });
      created++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      results.push({ row: rowNum, name, status: 'skipped', error: msg });
      skipped++;
    }
  }

  return NextResponse.json({ created, skipped, rows: results });
}
