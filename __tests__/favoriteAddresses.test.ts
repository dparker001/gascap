/**
 * Trip Planner Phase 2 — Favorite Addresses.
 * Covers: label normalization, duplicate-label warn-not-block flow,
 * cross-user ownership isolation on update/delete, and resolve-on-use
 * routing (google_place → fresh coordinates via placeId, manual_text →
 * the saved address string, never a cached coordinate).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface FavoriteAddressRow {
  id: string; userId: string; label: string; labelNormalized: string;
  displayAddress: string; placeId: string | null; source: string;
  createdAt: Date; updatedAt: Date;
}

const table = new Map<string, FavoriteAddressRow>();

function makeRow(overrides: Partial<FavoriteAddressRow> = {}): FavoriteAddressRow {
  const now = new Date('2026-10-11T00:00:00.000Z');
  return {
    id: 'fav-1', userId: 'user-1', label: 'Home', labelNormalized: 'home',
    displayAddress: '123 Main St', placeId: 'place-abc', source: 'google_place',
    createdAt: now, updatedAt: now,
    ...overrides,
  };
}

const prismaMock = {
  favoriteAddress: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = {
        ...data,
        createdAt: new Date('2026-10-11T00:00:00.000Z'),
        updatedAt: new Date('2026-10-11T00:00:00.000Z'),
      } as FavoriteAddressRow;
      table.set(row.id, row);
      return row;
    }),
    findFirst: vi.fn(async ({ where }: { where: { id?: string; userId: string; labelNormalized?: string } }) => {
      for (const row of table.values()) {
        if (row.userId !== where.userId) continue;
        if (where.id !== undefined && row.id !== where.id) continue;
        if (where.labelNormalized !== undefined && row.labelNormalized !== where.labelNormalized) continue;
        return { ...row };
      }
      return null;
    }),
    findMany: vi.fn(async ({ where }: { where: { userId: string } }) => {
      return [...table.values()].filter((r) => r.userId === where.userId).map((r) => ({ ...r }));
    }),
    // Mirrors real Postgres semantics: only rows matching the FULL where
    // clause are touched. If the caller passed just { id } (the original,
    // buggy shape an independent review caught — see favoriteAddresses.ts),
    // this mock would still "work" by accident since it's a Map keyed by
    // id; the point of test 17 below is asserting the actual CALL
    // arguments included userId, not relying on this mock to catch it.
    updateMany: vi.fn(async ({ where, data }: { where: { id: string; userId: string }; data: Partial<FavoriteAddressRow> }) => {
      const row = table.get(where.id);
      if (!row || row.userId !== where.userId) return { count: 0 };
      Object.assign(row, data, { updatedAt: new Date('2026-10-11T01:00:00.000Z') });
      return { count: 1 };
    }),
    deleteMany: vi.fn(async ({ where }: { where: { id: string; userId: string } }) => {
      const row = table.get(where.id);
      if (row && row.userId === where.userId) {
        table.delete(where.id);
        return { count: 1 };
      }
      return { count: 0 };
    }),
  },
};
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const resolvePlaceCoordinatesMock = vi.fn();
vi.mock('@/lib/mapsProvider', () => ({ resolvePlaceCoordinates: resolvePlaceCoordinatesMock }));

let mod: typeof import('@/lib/favoriteAddresses');

beforeEach(async () => {
  vi.clearAllMocks();
  table.clear();
  resolvePlaceCoordinatesMock.mockReset();
  mod = await import('@/lib/favoriteAddresses');
});

describe('normalizeLabel', () => {
  it('1. lowercases and collapses whitespace so "Home", "home", " HOME " all normalize the same', () => {
    expect(mod.normalizeLabel('Home')).toBe('home');
    expect(mod.normalizeLabel('  HOME  ')).toBe('home');
    expect(mod.normalizeLabel('Family   Meeting Spot')).toBe('family meeting spot');
  });
});

describe('createFavoriteAddress', () => {
  it('2. creates a google_place favorite with placeId, no lat/lng column involved', async () => {
    const result = await mod.createFavoriteAddress('user-1', {
      label: 'Work', displayAddress: '456 Office Blvd', placeId: 'place-xyz', source: 'google_place',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.favorite.label).toBe('Work');
      expect(result.favorite.placeId).toBe('place-xyz');
      expect(result.favorite.source).toBe('google_place');
    }
  });

  it('3. creates a manual_text favorite with no placeId required', async () => {
    const result = await mod.createFavoriteAddress('user-1', {
      label: 'Cabin', displayAddress: 'Rural Route 4, somewhere remote', source: 'manual_text',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.favorite.placeId).toBeUndefined();
  });

  it('4. rejects a google_place source with no placeId (never invents one)', async () => {
    const result = await mod.createFavoriteAddress('user-1', {
      label: 'Broken', displayAddress: 'Somewhere', source: 'google_place',
    });
    expect(result.ok).toBe(false);
  });

  it('5. a same-label duplicate (case/whitespace-insensitive) warns instead of saving, by default', async () => {
    table.set('fav-1', makeRow());
    const result = await mod.createFavoriteAddress('user-1', {
      label: '  HOME  ', displayAddress: '999 Other St', placeId: 'place-new', source: 'google_place',
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'duplicate_label') {
      expect(result.existing.id).toBe('fav-1');
    }
    expect([...table.values()]).toHaveLength(1); // nothing new was saved
  });

  it('6. confirmDuplicate=true saves anyway, allowing the same address under two labels / two "Home"s', async () => {
    table.set('fav-1', makeRow());
    const result = await mod.createFavoriteAddress(
      'user-1',
      { label: 'Home', displayAddress: '999 Other St', placeId: 'place-new', source: 'google_place' },
      true,
    );
    expect(result.ok).toBe(true);
    expect([...table.values()]).toHaveLength(2);
  });

  it('7. a duplicate label for a DIFFERENT user is not flagged (no cross-user leakage into the duplicate check)', async () => {
    table.set('fav-1', makeRow({ userId: 'user-1' }));
    const result = await mod.createFavoriteAddress('user-2', {
      label: 'Home', displayAddress: '1 Other Ave', placeId: 'place-other', source: 'google_place',
    });
    expect(result.ok).toBe(true);
  });
});

describe('updateFavoriteAddress / deleteFavoriteAddress — ownership isolation', () => {
  it('8. updating a favorite that belongs to another user returns undefined (no-op), not an error leaking existence', async () => {
    table.set('fav-1', makeRow({ userId: 'user-1' }));
    const result = await mod.updateFavoriteAddress('user-2', 'fav-1', { label: 'Hijacked' });
    expect(result).toBeUndefined();
    expect(table.get('fav-1')!.label).toBe('Home'); // untouched
  });

  it('9. the owner can update their own favorite', async () => {
    table.set('fav-1', makeRow({ userId: 'user-1' }));
    const result = await mod.updateFavoriteAddress('user-1', 'fav-1', { label: 'Home Sweet Home' });
    expect(result?.label).toBe('Home Sweet Home');
  });

  it('17. the actual mutation call is itself scoped by (id, userId) — not just the preceding ownership lookup (independent-review finding)', async () => {
    table.set('fav-1', makeRow({ userId: 'user-1' }));
    await mod.updateFavoriteAddress('user-1', 'fav-1', { label: 'Renamed' });
    // Fails against the pre-fix code, which called
    // prisma.favoriteAddress.update({ where: { id }, data }) — no updateMany
    // call existed at all, and the mutation's own where clause never
    // carried userId, so this assertion is the structural proof that the
    // write path itself enforces ownership, not merely an earlier check.
    expect(prismaMock.favoriteAddress.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'fav-1', userId: 'user-1' } }),
    );
  });

  it('10. deleting another user\'s favorite is a no-op (count=0), the row survives', async () => {
    table.set('fav-1', makeRow({ userId: 'user-1' }));
    const deleted = await mod.deleteFavoriteAddress('user-2', 'fav-1');
    expect(deleted).toBe(false);
    expect(table.has('fav-1')).toBe(true);
  });

  it('11. the owner can delete their own favorite', async () => {
    table.set('fav-1', makeRow({ userId: 'user-1' }));
    const deleted = await mod.deleteFavoriteAddress('user-1', 'fav-1');
    expect(deleted).toBe(true);
    expect(table.has('fav-1')).toBe(false);
  });
});

describe('listFavoriteAddresses — tenant isolation', () => {
  it('12. only returns the requesting user\'s favorites', async () => {
    table.set('fav-1', makeRow({ id: 'fav-1', userId: 'user-1' }));
    table.set('fav-2', makeRow({ id: 'fav-2', userId: 'user-2' }));
    const list = await mod.listFavoriteAddresses('user-1');
    expect(list.map((f) => f.id)).toEqual(['fav-1']);
  });
});

describe('resolveFavoriteAddressForRouting — resolve-on-use, never a cached coordinate', () => {
  it('13. a google_place favorite resolves fresh coordinates via its placeId', async () => {
    table.set('fav-1', makeRow({ source: 'google_place', placeId: 'place-abc' }));
    resolvePlaceCoordinatesMock.mockResolvedValueOnce({ latitude: 28.5, longitude: -81.4 });
    const result = await mod.resolveFavoriteAddressForRouting('user-1', 'fav-1');
    expect(result).toEqual({ kind: 'coordinates', latitude: 28.5, longitude: -81.4 });
    expect(resolvePlaceCoordinatesMock).toHaveBeenCalledWith('place-abc');
  });

  it('14. a manual_text favorite resolves to its saved address string, never calling Google', async () => {
    table.set('fav-1', makeRow({ source: 'manual_text', placeId: null, displayAddress: 'Rural Route 4' }));
    const result = await mod.resolveFavoriteAddressForRouting('user-1', 'fav-1');
    expect(result).toEqual({ kind: 'address', text: 'Rural Route 4' });
    expect(resolvePlaceCoordinatesMock).not.toHaveBeenCalled();
  });

  it('15. if Google Place Details fails for a google_place favorite, falls back to the saved address text rather than failing outright, flagged as a fallback', async () => {
    table.set('fav-1', makeRow({ source: 'google_place', placeId: 'place-abc', displayAddress: '123 Main St' }));
    resolvePlaceCoordinatesMock.mockResolvedValueOnce(null);
    const result = await mod.resolveFavoriteAddressForRouting('user-1', 'fav-1');
    // usedFallback: true distinguishes this from a genuine manual_text
    // favorite, so the caller can surface it to the user (per independent
    // review) rather than silently treating a stale/unresolvable place the
    // same as an intentionally-manual address.
    expect(result).toEqual({ kind: 'address', text: '123 Main St', usedFallback: true });
  });

  it('15b. a genuine manual_text favorite never carries usedFallback (it is not a fallback, it is the normal mode)', async () => {
    table.set('fav-1', makeRow({ source: 'manual_text', placeId: null, displayAddress: 'Rural Route 4' }));
    const result = await mod.resolveFavoriteAddressForRouting('user-1', 'fav-1');
    expect(result).toEqual({ kind: 'address', text: 'Rural Route 4' });
  });

  it('16. resolving a favorite that does not belong to the requesting user returns not_found', async () => {
    table.set('fav-1', makeRow({ userId: 'user-1' }));
    const result = await mod.resolveFavoriteAddressForRouting('user-2', 'fav-1');
    expect(result).toEqual({ kind: 'not_found' });
  });
});
