/**
 * Shared RentalSession row lock (2026-10-03).
 *
 * Fillup.rentalSessionId is a loose link (no FK), so nothing in the database
 * stops a refuel from inserting a Fillup for a rental that a concurrent delete
 * is removing — the new row would be an orphan. Both writers therefore take
 * the SAME row lock on the owned RentalSession, first thing inside their
 * interactive transaction, before touching any Fillup:
 *
 *   deleteRentalSession(): lock → delete the rental's Fillups → delete rental
 *   createRentalFillup():  lock → checks → insert Fillup → bump fuel state
 *
 * Postgres `SELECT … FOR UPDATE` blocks the second transaction until the first
 * commits; under READ COMMITTED the waiter then re-reads the row, so:
 *   - refuel first  → its Fillup commits, then the delete removes it too;
 *   - delete first  → the waiting refuel finds no row and creates nothing.
 * One lock, one row, always taken first — so there is no lock-order deadlock
 * between these two paths. Parameterized via the tagged template (no string
 * interpolation into SQL).
 */
import type { Prisma } from '@/lib/generated/prisma/client';

export async function lockOwnedRentalSession(tx: Prisma.TransactionClient, id: string, userId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "RentalSession" WHERE "id" = ${id} AND "userId" = ${userId} FOR UPDATE
  `;
  return rows.length > 0;
}
