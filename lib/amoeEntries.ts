/**
 * Alternative Method of Entry (AMOE) — the free, no-purchase entry path.
 *
 * These submissions were being written to disk and never read by the drawing
 * code. `getEligibleEntrants` queries Prisma for plan IN ('pro','fleet'), so
 * an AMOE entrant had no chance of winning at all — while the posted rules
 * state "No purchase is required to enter." A sweepstakes whose free entry
 * method cannot win is the thing sweepstakes law exists to prevent, so the
 * read path lives here, shared by the submit endpoint and the draw, and is
 * deliberately hard to skip silently.
 */

import fs from 'fs';
import path from 'path';

export const AMOE_DATA_FILE = path.join(process.cwd(), 'data', 'amoe-entries.json');

/** One AMOE submission is worth exactly one entry. */
export const AMOE_ENTRY_VALUE = 1;

export interface AmoeEntry {
  id:          string;
  firstName:   string;
  lastName:    string;
  email:       string;
  month:       string;   // YYYY-MM
  submittedAt: string;
}

export function normalizeAmoeEmail(e: string): string {
  return e.trim().toLowerCase();
}

/**
 * Read every AMOE submission.
 *
 * A missing file means nobody has entered yet and is legitimately empty. Any
 * OTHER failure — unreadable, corrupt JSON, wrong shape — THROWS. That
 * distinction is the whole point: swallowing errors here is exactly how the
 * free entry path went unnoticed. A draw must fail loudly rather than quietly
 * proceed without the entrants who are legally entitled to be in it.
 */
export function readAmoeEntries(): AmoeEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(AMOE_DATA_FILE, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(
      `AMOE entries file could not be read (${(err as Error).message}). ` +
      'Refusing to continue: proceeding would exclude free entrants from the draw.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('AMOE entries file is not valid JSON. Refusing to draw without free entrants.');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('AMOE entries file is not an array. Refusing to draw without free entrants.');
  }
  return parsed as AmoeEntry[];
}

export function writeAmoeEntries(entries: AmoeEntry[]): void {
  fs.mkdirSync(path.dirname(AMOE_DATA_FILE), { recursive: true });
  fs.writeFileSync(AMOE_DATA_FILE, JSON.stringify(entries, null, 2));
}

/** Submissions for one draw period. */
export function amoeEntriesForMonth(month: string): AmoeEntry[] {
  return readAmoeEntries().filter((e) => e.month === month);
}

/**
 * Stable per-person id, derived from the email rather than the submission id.
 *
 * Repeat-winner restrictions match on the recorded winner id, so a random id
 * per submission would let the same person win in consecutive months while a
 * registered user could not. Keyed by email, the restriction applies evenly.
 */
export function amoeEntrantId(email: string): string {
  return `amoe:${normalizeAmoeEmail(email)}`;
}
