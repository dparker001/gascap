/**
 * READ-ONLY rental/Fillup integrity helpers (2026-10-03).
 *
 * An orphan rental Fillup is a Fillup with rentalSessionId != null whose
 * RentalSession no longer exists. They were produced by every rental delete
 * before deleteRentalSession() started removing a rental's Fillups in the
 * same transaction; they still show in the owner's personal fill-up list and
 * stats (getFillups() filters by userId only). Nothing here writes.
 */
import { prisma } from './prisma';

export interface LinkedFillup {
  id:              string;
  userId:          string;
  rentalSessionId: string | null;
  fillupType:      string | null;
  gallonsPumped:   number;
  totalCost:       number;
  date:            string;
  createdAt:       string;
}

/** Pure: the linked Fillups whose rental id is not among the existing rental ids. */
export function orphanRentalFillups(linked: LinkedFillup[], existingRentalIds: Iterable<string>): LinkedFillup[] {
  const existing = new Set(existingRentalIds);
  return linked.filter((f) => f.rentalSessionId != null && !existing.has(f.rentalSessionId));
}

export interface OrphanSummary {
  orphanCount:   number;
  affectedUsers: number;
  oldestDate:    string | null;
  newestDate:    string | null;
  byType:        { trip: number; final_return: number; other: number };
  totalGallons:  number;
  totalCost:     number;
}

/** Pure, aggregate-only — no ids, emails or per-user detail leave this function. */
export function summarizeOrphans(rows: LinkedFillup[]): OrphanSummary {
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    orphanCount:   rows.length,
    affectedUsers: new Set(rows.map((r) => r.userId)).size,
    oldestDate:    dates[0] ?? null,
    newestDate:    dates[dates.length - 1] ?? null,
    byType: {
      trip:         rows.filter((r) => r.fillupType === 'trip').length,
      final_return: rows.filter((r) => r.fillupType === 'final_return').length,
      other:        rows.filter((r) => r.fillupType !== 'trip' && r.fillupType !== 'final_return').length,
    },
    totalGallons: round2(rows.reduce((s, r) => s + (r.gallonsPumped ?? 0), 0)),
    totalCost:    round2(rows.reduce((s, r) => s + (r.totalCost ?? 0), 0)),
  };
}

/**
 * READ-ONLY. Every orphan rental Fillup, regardless of when it was created —
 * a Fillup created long ago becomes an orphan the moment its rental is
 * deleted, so a creation-date filter would hide exactly the regression this
 * looks for. Production audit 2026-10-03: 0 rental-linked Fillups, 0
 * orphans, so there is no backlog to suppress. If this grows expensive,
 * optimize the query (anti-join), never narrow the invariant. Two selects;
 * never updates or deletes.
 */
export async function findOrphanRentalFillups(): Promise<LinkedFillup[]> {
  const linked = await prisma.fillup.findMany({
    where:  { rentalSessionId: { not: null } },
    select: { id: true, userId: true, rentalSessionId: true, fillupType: true, gallonsPumped: true, totalCost: true, date: true, createdAt: true },
  });
  if (linked.length === 0) return [];
  const rentalIds = [...new Set(linked.map((f) => f.rentalSessionId as string))];
  const existing = await prisma.rentalSession.findMany({ where: { id: { in: rentalIds } }, select: { id: true } });
  return orphanRentalFillups(linked as LinkedFillup[], existing.map((r) => r.id));
}
