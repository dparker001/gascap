/**
 * POST /api/amoe
 * Free Alternative Method of Entry for the GasCap™ Monthly Gas Card Giveaway.
 *
 * Anti-spam:
 *  - Honeypot field ("website") — if present, silently accept but don't save
 *  - One submission per email address per calendar month (enforced server-side)
 *  - No email address is exposed anywhere in the UI
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import {
  readAmoeEntries, writeAmoeEntries, normalizeAmoeEmail, type AmoeEntry,
} from '@/lib/amoeEntries';
import { mirrorAmoeEntryToDb } from '@/lib/amoeEntriesDb';

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

export async function POST(req: NextRequest) {
  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const { firstName, lastName, email, website } = body;

  // Honeypot — bots fill this hidden field; humans leave it blank
  // Silently accept but don't save so the bot doesn't know it failed
  if (website) {
    return NextResponse.json({ ok: true });
  }

  // Basic validation
  if (!firstName?.trim() || !lastName?.trim()) {
    return NextResponse.json({ error: 'First and last name are required.' }, { status: 400 });
  }
  const emailTrimmed = normalizeAmoeEmail(email ?? '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
    return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
  }

  const month = currentMonth();

  // Rate limit — one entry per email per calendar month
  const entries = readAmoeEntries();
  const alreadyEntered = entries.some(
    (e) => e.email === emailTrimmed && e.month === month,
  );
  if (alreadyEntered) {
    return NextResponse.json(
      { error: `You've already submitted a free entry for this month. Check back on the 1st!` },
      { status: 409 },
    );
  }

  // Save
  const newEntry: AmoeEntry = {
    id:          randomUUID(),
    firstName:   firstName.trim(),
    lastName:    lastName.trim(),
    email:       emailTrimmed,
    month,
    submittedAt: new Date().toISOString(),
  };
  entries.push(newEntry);
  writeAmoeEntries(entries);

  // Sprint 2 — best-effort mirror to Postgres, staged ahead of a future
  // read-path cutover. The file write above is unconditional and unaffected;
  // this never blocks or fails the actual submission. See lib/amoeEntriesDb.ts.
  void mirrorAmoeEntryToDb(newEntry);

  return NextResponse.json({ ok: true });
}
