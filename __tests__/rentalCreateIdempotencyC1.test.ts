/**
 * C1 — create idempotency (clientRentalId), soft duplicate warning and user
 * cancel, at the lib and route level. The fake DB models what the logic
 * relies on: a unique primary key (a second insert of the same id throws a
 * real Prisma P2002), owner-scoped lookups, and conditional updateMany.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { Prisma } from '@/lib/generated/prisma/client';

type Row = Record<string, unknown> & { id: string; userId: string; status: string };
const db = { rows: [] as Row[], beforeCreate: null as null | (() => void), beforeFindMany: null as null | (() => void), failCreate: null as null | Error, creates: 0 };

const p2002 = () => new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 't', meta: { target: ['id'] } });
const tick = () => Promise.resolve();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    rentalSession: {
      findUnique: async ({ where }: { where: { id: string } }) => { await tick(); return db.rows.find((r) => r.id === where.id) ?? null; },
      findFirst:  async ({ where }: { where: { id: string; userId: string } }) => { await tick(); return db.rows.find((r) => r.id === where.id && r.userId === where.userId) ?? null; },
      findMany:   async ({ where }: { where: { userId: string; status: string } }) => { await tick(); db.beforeFindMany?.(); return db.rows.filter((r) => r.userId === where.userId && r.status === where.status); },
      create: async ({ data }: { data: Row }) => {
        await tick();
        db.beforeCreate?.();
        if (db.failCreate) throw db.failCreate;
        if (db.rows.some((r) => r.id === data.id)) throw p2002();
        db.creates += 1;
        db.rows.push({ ...data });
        return { ...data };
      },
      updateMany: async ({ where, data }: { where: { id: string; userId: string; status: string }; data: Record<string, unknown> }) => {
        await tick();
        let count = 0;
        for (const r of db.rows) if (r.id === where.id && r.userId === where.userId && r.status === where.status) { Object.assign(r, data); count += 1; }
        return { count };
      },
    },
  },
}));
const analytics = vi.fn(async (_e: unknown) => {});
vi.mock('@/lib/analyticsEvents', () => ({ recordAnalyticsEvent: (e: unknown) => analytics(e) }));

const ID = '3f2b8c1e-5a4d-4e7b-9c2a-1d6e8f0a7b3c';
const input = (over: Record<string, unknown> = {}) => ({
  rentalCompany: 'Hertz', rentalConfirmationNumber: 'AB-123',
  pickupDateTime: '2026-10-10T10:00', returnDateTime: '2026-10-13T10:00',
  pickupTimeZone: 'America/New_York', returnTimeZone: 'America/New_York', ...over,
});
const lib = () => import('@/lib/rentalSessions');

beforeEach(() => { db.rows = []; db.beforeCreate = null; db.beforeFindMany = null; db.failCreate = null; db.creates = 0; analytics.mockClear(); });

describe('clientRentalId validation', () => {
  it('accepts UUIDv4 only', async () => {
    const { isClientRentalId } = await lib();
    expect(isClientRentalId(ID)).toBe(true);
    expect(isClientRentalId(ID.toUpperCase())).toBe(true);
    for (const bad of ['', 'abc', 123, null, undefined, '3f2b8c1e-5a4d-1e7b-9c2a-1d6e8f0a7b3c', '3f2b8c1e5a4d4e7b9c2a1d6e8f0a7b3c', `${ID} `]) {
      expect(isClientRentalId(bad)).toBe(false);
    }
  });
});

describe('createRentalSessionIdempotent', () => {
  it('uses the client id as the row id and writes exactly one row + one analytics event', async () => {
    const { createRentalSessionIdempotent } = await lib();
    const r = await createRentalSessionIdempotent('u1', input(), { clientRentalId: ID });
    expect(r.kind).toBe('created');
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].id).toBe(ID);
    expect(analytics).toHaveBeenCalledTimes(1);
  });
  it('without a client id behaves as before (random id, no replay protection)', async () => {
    const { createRentalSessionIdempotent } = await lib();
    const r = await createRentalSessionIdempotent('u1', input({ rentalConfirmationNumber: 'X1' }));
    expect(r.kind).toBe('created');
    expect(db.rows[0].id).not.toBe(ID);
  });
  it('REPLAY: same user, same id, same content → the original row, no second write, no second analytics event', async () => {
    const { createRentalSessionIdempotent } = await lib();
    await createRentalSessionIdempotent('u1', input(), { clientRentalId: ID });
    const again = await createRentalSessionIdempotent('u1', input(), { clientRentalId: ID });
    expect(again.kind).toBe('replayed');
    expect(again.kind === 'replayed' && again.session.id).toBe(ID);
    expect(db.rows).toHaveLength(1);
    expect(analytics).toHaveBeenCalledTimes(1);
  });
  it('replay is recognised BEFORE duplicate detection (it must not duplicate its own row)', async () => {
    const { createRentalSessionIdempotent } = await lib();
    await createRentalSessionIdempotent('u1', input(), { clientRentalId: ID });
    // same company + confirmation as the row it just wrote — would match on confirmation
    const again = await createRentalSessionIdempotent('u1', input(), { clientRentalId: ID });
    expect(again.kind).toBe('replayed');
  });
  it('CONFLICTING PAYLOAD: same id, different content → conflict, original untouched', async () => {
    const { createRentalSessionIdempotent } = await lib();
    await createRentalSessionIdempotent('u1', input(), { clientRentalId: ID });
    for (const changed of [{ notes: 'different' }, { rentalCompany: 'Avis' }, { pickupDateTime: '2026-10-10T11:00' }, { pickupLocation: 'MCO' }]) {
      expect((await createRentalSessionIdempotent('u1', input(changed), { clientRentalId: ID })).kind).toBe('conflict');
    }
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].rentalCompany).toBe('Hertz');
  });
  it("ANOTHER USER'S id → conflict, nothing written, nothing returned", async () => {
    const { createRentalSessionIdempotent } = await lib();
    await createRentalSessionIdempotent('u1', input(), { clientRentalId: ID });
    const r = await createRentalSessionIdempotent('u2', input(), { clientRentalId: ID });
    expect(r).toEqual({ kind: 'conflict' });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].userId).toBe('u1');
  });

  describe('concurrency', () => {
    it('two parallel identical requests → exactly one row; one created, one replayed', async () => {
      const { createRentalSessionIdempotent } = await lib();
      const [a, b] = await Promise.all([
        createRentalSessionIdempotent('u1', input(), { clientRentalId: ID }),
        createRentalSessionIdempotent('u1', input(), { clientRentalId: ID }),
      ]);
      expect([a.kind, b.kind].sort()).toEqual(['created', 'replayed']);
      expect(db.rows).toHaveLength(1);
      expect(analytics).toHaveBeenCalledTimes(1);
    });
    it('a competitor inserting between the id check and the duplicate scan is a replay, not a "duplicate"', async () => {
      const { createRentalSessionIdempotent } = await lib();
      // Capture the exact row an identical request writes, then remove it…
      await createRentalSessionIdempotent('u1', input(), { clientRentalId: ID });
      const saved = { ...db.rows[0] };
      db.rows = [];
      // …and let it "arrive" right after this request's own id lookup came back empty.
      db.beforeFindMany = () => { db.beforeFindMany = null; db.rows.push({ ...saved }); };
      const r = await createRentalSessionIdempotent('u1', input(), { clientRentalId: ID });
      expect(r.kind).toBe('replayed');
      expect(db.rows).toHaveLength(1);
    });
    it('two parallel requests with the SAME id but DIFFERENT content → one wins, the other conflicts', async () => {
      const { createRentalSessionIdempotent } = await lib();
      const [a, b] = await Promise.all([
        createRentalSessionIdempotent('u1', input({ notes: 'A' }), { clientRentalId: ID }),
        createRentalSessionIdempotent('u1', input({ notes: 'B' }), { clientRentalId: ID }),
      ]);
      expect([a.kind, b.kind].sort()).toEqual(['conflict', 'created']);
      expect(db.rows).toHaveLength(1);
    });
    it('an insert that loses the race to a competitor with the same id is classified by content (replay)', async () => {
      const { createRentalSessionIdempotent } = await lib();
      // Competitor row appears exactly when this request tries to insert.
      db.beforeCreate = () => {
        db.beforeCreate = null;
        db.rows.push({ id: ID, userId: 'u1', status: 'active', rentalCompany: 'Hertz' } as Row);
      };
      const r = await createRentalSessionIdempotent('u1', input(), { clientRentalId: ID });
      // the competitor's row has different stored content than this request → conflict (never a silent replay)
      expect(r.kind).toBe('conflict');
      expect(db.rows).toHaveLength(1);
    });
    it('a non-P2002 insert failure is rethrown, not swallowed', async () => {
      const { createRentalSessionIdempotent } = await lib();
      db.failCreate = new Error('db down');
      await expect(createRentalSessionIdempotent('u1', input(), { clientRentalId: ID })).rejects.toThrow('db down');
      expect(db.rows).toHaveLength(0);
    });
    it('a P2002 WITHOUT a client id is rethrown (nothing to replay against)', async () => {
      const { createRentalSessionIdempotent } = await lib();
      db.failCreate = p2002();
      await expect(createRentalSessionIdempotent('u1', input())).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });
  });

  describe('soft duplicate detection', () => {
    it('same company + confirmation → duplicate, nothing written', async () => {
      const { createRentalSessionIdempotent } = await lib();
      const first = await createRentalSessionIdempotent('u1', input());
      const r = await createRentalSessionIdempotent('u1', input({ rentalConfirmationNumber: 'ab 123' }));
      expect(r).toMatchObject({ kind: 'duplicate', matchedOn: 'confirmation', rentalId: first.kind === 'created' ? first.session.id : '' });
      expect(db.rows).toHaveLength(1);
    });
    it('same company, pickup within 36h, no confirmation conflict → duplicate (pickup_window)', async () => {
      const { createRentalSessionIdempotent } = await lib();
      await createRentalSessionIdempotent('u1', input({ rentalConfirmationNumber: undefined }));
      const r = await createRentalSessionIdempotent('u1', input({ rentalConfirmationNumber: undefined, pickupDateTime: '2026-10-11T10:00', returnDateTime: '2026-10-14T10:00' }));
      expect(r).toMatchObject({ kind: 'duplicate', matchedOn: 'pickup_window' });
    });
    it('a different confirmation number is a different booking, even at the same pickup', async () => {
      const { createRentalSessionIdempotent } = await lib();
      await createRentalSessionIdempotent('u1', input());
      expect((await createRentalSessionIdempotent('u1', input({ rentalConfirmationNumber: 'ZZ-999' }))).kind).toBe('created');
    });
    it('confirmDuplicate saves anyway', async () => {
      const { createRentalSessionIdempotent } = await lib();
      await createRentalSessionIdempotent('u1', input());
      const r = await createRentalSessionIdempotent('u1', input({ rentalConfirmationNumber: 'ab 123' }), { confirmDuplicate: true });
      expect(r.kind).toBe('created');
      expect(db.rows).toHaveLength(2);
    });
    it("only the same user's ACTIVE rentals count (other users, completed and cancelled never match)", async () => {
      const { createRentalSessionIdempotent } = await lib();
      await createRentalSessionIdempotent('u2', input());
      expect((await createRentalSessionIdempotent('u1', input())).kind).toBe('created');
      db.rows.find((r) => r.userId === 'u1')!.status = 'completed';
      expect((await createRentalSessionIdempotent('u1', input({ rentalConfirmationNumber: 'AB-123' }))).kind).toBe('created');
      db.rows.filter((r) => r.userId === 'u1').forEach((r) => { r.status = 'cancelled'; });
      expect((await createRentalSessionIdempotent('u1', input())).kind).toBe('created');
    });
    it('a retry with the duplicate confirmed keeps the same client id and still yields one row on a second retry', async () => {
      const { createRentalSessionIdempotent } = await lib();
      await createRentalSessionIdempotent('u1', input());
      const first = await createRentalSessionIdempotent('u1', input(), { clientRentalId: ID, confirmDuplicate: true });
      const retry = await createRentalSessionIdempotent('u1', input(), { clientRentalId: ID, confirmDuplicate: true });
      expect([first.kind, retry.kind]).toEqual(['created', 'replayed']);
      expect(db.rows).toHaveLength(2);
    });
  });

  it('schedule/zone validation still throws BEFORE any read or write', async () => {
    const { createRentalSessionIdempotent, RentalScheduleError } = await lib();
    await expect(createRentalSessionIdempotent('u1', input({ pickupTimeZone: 'EST' }), { clientRentalId: ID })).rejects.toBeInstanceOf(RentalScheduleError);
    expect(db.rows).toHaveLength(0);
  });
  it('never infers fuel: a bare quick-save row has no fuel, vehicle or tank fields set', async () => {
    const { createRentalSessionIdempotent } = await lib();
    await createRentalSessionIdempotent('u1', input(), { clientRentalId: ID });
    const row = db.rows[0];
    for (const k of ['pickupFuelGallons', 'currentFuelGallons', 'fuelTankCapacityGallons', 'vehicleMake', 'vehicleModel']) expect(row[k]).toBeNull();
  });
  it('the plain createRentalSession still writes the same shape (refactor guard)', async () => {
    const { createRentalSession } = await lib();
    const s = await createRentalSession('u1', input());
    expect(s.status).toBe('active');
    expect(s.provider).toBe('manual');
    expect(db.rows).toHaveLength(1);
  });
});

describe('cancelRentalSession', () => {
  const seed = (over: Partial<Row> = {}) => { db.rows.push({ id: 'r1', userId: 'u1', status: 'active', ...over } as Row); };
  it('cancels an active rental it owns', async () => {
    const { cancelRentalSession } = await lib();
    seed();
    const r = await cancelRentalSession('u1', 'r1');
    expect(r.kind).toBe('cancelled');
    expect(db.rows[0].status).toBe('cancelled');
  });
  it('is idempotent — a repeat (or concurrent) cancel succeeds with the same state', async () => {
    const { cancelRentalSession } = await lib();
    seed();
    const [a, b, c] = await Promise.all([cancelRentalSession('u1', 'r1'), cancelRentalSession('u1', 'r1'), cancelRentalSession('u1', 'r1')]);
    expect([a.kind, b.kind, c.kind]).toEqual(['cancelled', 'cancelled', 'cancelled']);
    expect((await cancelRentalSession('u1', 'r1')).kind).toBe('cancelled');
  });
  it("is owner-scoped: another user's rental is not found and is never changed", async () => {
    const { cancelRentalSession } = await lib();
    seed({ userId: 'u2' });
    expect(await cancelRentalSession('u1', 'r1')).toEqual({ kind: 'not_found' });
    expect(db.rows[0].status).toBe('active');
  });
  it('never overwrites a completed rental', async () => {
    const { cancelRentalSession } = await lib();
    seed({ status: 'completed' });
    expect(await cancelRentalSession('u1', 'r1')).toEqual({ kind: 'completed' });
    expect(db.rows[0].status).toBe('completed');
  });
  it('unknown id → not found', async () => {
    const { cancelRentalSession } = await lib();
    expect(await cancelRentalSession('u1', 'nope')).toEqual({ kind: 'not_found' });
  });
});

// ── Routes ──────────────────────────────────────────────────────────────────
let sessionUser: { id: string } | null = { id: 'u1' };
let isPro = true;
const getLivePlan = vi.fn(async () => ({ isPro }));
vi.mock('next-auth', () => ({ getServerSession: async () => (sessionUser ? { user: sessionUser } : null) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/serverPlan', () => ({ getLivePlan: () => getLivePlan() }));

describe('POST /api/rental-sessions (route)', () => {
  const post = async (body: Record<string, unknown>) => {
    const { POST } = await import('@/app/api/rental-sessions/route');
    const res = await POST(new Request('https://x/api/rental-sessions', { method: 'POST', body: JSON.stringify(body) }) as never);
    return { status: res.status, body: await res.json() };
  };
  beforeEach(() => { sessionUser = { id: 'u1' }; isPro = true; getLivePlan.mockClear(); });

  it('Pro gate is unchanged: a free user is refused before anything is read or written', async () => {
    isPro = false;
    const r = await post({ ...input(), clientRentalId: ID });
    expect(r.status).toBe(403);
    expect(r.body.proRequired).toBe(true);
    expect(db.rows).toHaveLength(0);
  });
  it('unauthenticated → 401', async () => {
    sessionUser = null;
    expect((await post(input())).status).toBe(401);
  });
  it('malformed clientRentalId → 400, nothing written', async () => {
    for (const bad of ['nope', 12, '', null]) {
      const r = await post({ ...input(), clientRentalId: bad });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('invalid_client_rental_id');
    }
    expect(db.rows).toHaveLength(0);
  });
  it('201 on create, 200 {replayed:true} on a replay, 409 client_rental_id_conflict on different content', async () => {
    const a = await post({ ...input(), clientRentalId: ID });
    expect(a.status).toBe(201);
    const b = await post({ ...input(), clientRentalId: ID });
    expect(b.status).toBe(200);
    expect(b.body.replayed).toBe(true);
    expect(b.body.session.id).toBe(ID);
    const c = await post({ ...input({ notes: 'other' }), clientRentalId: ID });
    expect(c.status).toBe(409);
    expect(c.body.error).toBe('client_rental_id_conflict');
    expect(db.rows).toHaveLength(1);
  });
  it('409 possible_duplicate exposes only error, rentalId and matchedOn; confirmDuplicate saves anyway', async () => {
    const first = await post(input());
    const dup = await post(input());
    expect(dup.status).toBe(409);
    expect(dup.body).toEqual({ error: 'possible_duplicate', rentalId: first.body.session.id, matchedOn: 'confirmation' });
    const forced = await post({ ...input(), confirmDuplicate: true });
    expect(forced.status).toBe(201);
    expect(db.rows).toHaveLength(2);
  });
  it('confirmDuplicate must be exactly true (truthy strings do not bypass the warning)', async () => {
    await post(input());
    expect((await post({ ...input(), confirmDuplicate: 'true' })).status).toBe(409);
    expect((await post({ ...input(), confirmDuplicate: 1 })).status).toBe(409);
  });
  it('existing schedule-error mapping is intact (invalid zone → 400)', async () => {
    const r = await post({ ...input({ pickupTimeZone: 'EST' }), clientRentalId: ID });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_time_zone');
    expect(db.rows).toHaveLength(0);
  });
});

describe('POST /api/rental-sessions/[id]/cancel (route)', () => {
  const cancel = async (id = 'r1') => {
    const { POST } = await import('@/app/api/rental-sessions/[id]/cancel/route');
    const res = await POST(new Request('https://x', { method: 'POST' }) as never, { params: { id } });
    return { status: res.status, body: await res.json() };
  };
  beforeEach(() => { sessionUser = { id: 'u1' }; isPro = true; getLivePlan.mockClear(); db.rows = [{ id: 'r1', userId: 'u1', status: 'active' } as Row]; });

  it('401 unauthenticated; 404 for someone else’s rental', async () => {
    sessionUser = null;
    expect((await cancel()).status).toBe(401);
    sessionUser = { id: 'u2' };
    expect((await cancel()).status).toBe(404);
    expect(db.rows[0].status).toBe('active');
  });
  it('200 and idempotent on repeat; 409 already_completed for a returned rental', async () => {
    expect((await cancel()).status).toBe(200);
    expect((await cancel()).status).toBe(200);
    db.rows = [{ id: 'r1', userId: 'u1', status: 'completed' } as Row];
    const r = await cancel();
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('already_completed');
  });
  it('is NOT Pro-gated — a lapsed user can still finish a rental', async () => {
    isPro = false;
    expect((await cancel()).status).toBe(200);
    expect(getLivePlan).not.toHaveBeenCalled();
  });
});

describe('scope guards', () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');
  it('the reminder cron is unchanged: no overdue notification tier, no outbox', () => {
    const cron = read('app/api/cron/rental-return-reminder/route.ts');
    expect(cron).not.toMatch(/overdue|RentalReminderDelivery|outbox/i);
  });
  it('no schema change: none of the future-design fields exist in the Prisma schema', () => {
    const schema = read('prisma/schema.prisma');
    for (const f of ['clientRentalId', 'sourceRefHash', 'RentalSourceLink', 'rentalAutoOpen', 'RentalReminderDelivery', 'calendarDiscoveryConsentAt']) {
      expect(schema).not.toContain(f);
    }
  });
  it('no native calendar code, permission or plugin was added', () => {
    const cap = read('capacitor.config.json');
    expect(cap).not.toMatch(/alendar/);
    expect(read('package.json')).not.toMatch(/capacitor[^"]*calendar/i);
  });
});
