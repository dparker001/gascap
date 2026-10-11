/**
 * GasCap™ — Favorite Addresses (Trip Planner Phase 2)
 *
 * A user-saved Trip Planner address (Home, Work, or a custom label) —
 * separate from FavoriteStation (a gas station with a price snapshot).
 * See prisma/schema.prisma's FavoriteAddress model doc comment for why no
 * latitude/longitude column exists: a 'google_place' favorite's
 * coordinates are resolved fresh via its placeId every time it's used
 * (resolveFavoriteAddressForRouting below), never cached here, per
 * Google's Places API retention limits on returned coordinates.
 */
import { prisma } from './prisma';
import { resolvePlaceCoordinates } from './mapsProvider';
import { randomUUID } from 'crypto';

export type FavoriteAddressSource = 'google_place' | 'manual_text';

export interface FavoriteAddress {
  id:              string;
  userId:          string;
  label:           string;
  displayAddress:  string;
  placeId?:        string;
  source:          FavoriteAddressSource;
  createdAt:       string;
  updatedAt:       string;
}

interface FavoriteAddressRow {
  id: string; userId: string; label: string; labelNormalized: string;
  displayAddress: string; placeId: string | null; source: string;
  createdAt: Date; updatedAt: Date;
}

function toFavoriteAddress(row: FavoriteAddressRow): FavoriteAddress {
  return {
    id:             row.id,
    userId:         row.userId,
    label:          row.label,
    displayAddress: row.displayAddress,
    placeId:        row.placeId ?? undefined,
    source:         row.source === 'google_place' ? 'google_place' : 'manual_text',
    createdAt:      row.createdAt.toISOString(),
    updatedAt:      row.updatedAt.toISOString(),
  };
}

/** Lowercased + whitespace-collapsed, for the same-label duplicate check — never a hard unique constraint (a user may legitimately want one address under two labels). */
export function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function listFavoriteAddresses(userId: string): Promise<FavoriteAddress[]> {
  const rows = await prisma.favoriteAddress.findMany({
    where:   { userId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toFavoriteAddress);
}

export interface CreateFavoriteAddressInput {
  label:          string;
  displayAddress: string;
  placeId?:       string;
  source:         FavoriteAddressSource;
}

export type CreateFavoriteAddressResult =
  | { ok: true; favorite: FavoriteAddress }
  | { ok: false; reason: 'duplicate_label'; existing: FavoriteAddress }
  | { ok: false; reason: 'invalid' };

/**
 * Creates a favorite. If `confirmDuplicate` is false (the default) and a
 * near-duplicate label already exists for this user (case/whitespace-
 * insensitive), returns the existing row as a WARNING rather than saving —
 * the API layer surfaces this for the user to explicitly acknowledge
 * before retrying with confirmDuplicate: true. Never a hard block: the
 * same physical address under two different labels, or two genuinely
 * different "Home"s (rare, but not our call to prevent), are both
 * legitimate per the approved Phase 2 design.
 */
export async function createFavoriteAddress(
  userId: string,
  input: CreateFavoriteAddressInput,
  confirmDuplicate = false,
): Promise<CreateFavoriteAddressResult> {
  const label          = input.label.trim();
  const displayAddress = input.displayAddress.trim();
  if (!label || !displayAddress) return { ok: false, reason: 'invalid' };
  if (input.source === 'google_place' && !input.placeId) return { ok: false, reason: 'invalid' };

  const labelNormalized = normalizeLabel(label);

  if (!confirmDuplicate) {
    const existing = await prisma.favoriteAddress.findFirst({ where: { userId, labelNormalized } });
    if (existing) return { ok: false, reason: 'duplicate_label', existing: toFavoriteAddress(existing) };
  }

  const row = await prisma.favoriteAddress.create({
    data: {
      id:              randomUUID(),
      userId,
      label,
      labelNormalized,
      displayAddress,
      placeId:         input.source === 'google_place' ? input.placeId : null,
      source:          input.source,
    },
  });

  return { ok: true, favorite: toFavoriteAddress(row) };
}

export interface UpdateFavoriteAddressInput {
  label?:          string;
  displayAddress?: string;
  placeId?:        string | null;
  source?:         FavoriteAddressSource;
}

/**
 * Scoped by (id, userId) at BOTH the ownership check and the actual
 * mutation — the initial findFirst alone is a check-then-use gap (an
 * independent review of this PR correctly caught that the first version
 * mutated with `update({ where: { id } })`, not re-scoped by userId, even
 * though a prior ownership lookup had passed). updateMany's where clause
 * is the one that actually has to be scoped; the findFirst is only there
 * to fail fast on bad input before building the patch.
 */
export async function updateFavoriteAddress(
  userId: string,
  id: string,
  patch: UpdateFavoriteAddressInput,
): Promise<FavoriteAddress | undefined> {
  const existing = await prisma.favoriteAddress.findFirst({ where: { id, userId } });
  if (!existing) return undefined;

  const data: Record<string, unknown> = {};
  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (!label) return undefined;
    data.label = label;
    data.labelNormalized = normalizeLabel(label);
  }
  if (patch.displayAddress !== undefined) {
    const displayAddress = patch.displayAddress.trim();
    if (!displayAddress) return undefined;
    data.displayAddress = displayAddress;
  }
  if (patch.source !== undefined) data.source = patch.source;
  if (patch.placeId !== undefined) data.placeId = patch.placeId;

  const { count } = await prisma.favoriteAddress.updateMany({ where: { id, userId }, data });
  if (count === 0) return undefined;
  const row = await prisma.favoriteAddress.findFirst({ where: { id, userId } });
  return row ? toFavoriteAddress(row) : undefined;
}

/** Scoped by (id, userId) — deleteMany so a mismatched owner silently deletes nothing rather than erroring. */
export async function deleteFavoriteAddress(userId: string, id: string): Promise<boolean> {
  const { count } = await prisma.favoriteAddress.deleteMany({ where: { id, userId } });
  return count > 0;
}

export type RouteOrigin =
  | { kind: 'coordinates'; latitude: number; longitude: number }
  | { kind: 'address'; text: string }
  | { kind: 'not_found' };

/**
 * Resolves a favorite into something /api/maps/route can use as an
 * origin/destination. 'google_place' favorites get fresh coordinates via
 * Place Details (never a cached value); 'manual_text' favorites are
 * handed back as a plain address string, routed exactly the way the Trip
 * Planner already routes any manually-typed address today — if Google
 * can't resolve it, the existing route-error handling applies rather than
 * this function inventing a location.
 */
export async function resolveFavoriteAddressForRouting(
  userId: string,
  id: string,
): Promise<RouteOrigin> {
  const row = await prisma.favoriteAddress.findFirst({ where: { id, userId } });
  if (!row) return { kind: 'not_found' };

  if (row.source === 'google_place' && row.placeId) {
    const coords = await resolvePlaceCoordinates(row.placeId);
    if (coords) return { kind: 'coordinates', latitude: coords.latitude, longitude: coords.longitude };
    // Google Place Details failed (placeId stale/revoked, API hiccup) — fall
    // back to the saved display text rather than failing the whole trip.
  }

  return { kind: 'address', text: row.displayAddress };
}
