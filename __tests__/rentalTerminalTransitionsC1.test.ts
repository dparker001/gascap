/**
 * PR #62 finding 1 — Complete and Cancel are atomic, mutually exclusive,
 * owner-scoped terminal transitions. The fake DB makes each conditional
 * UPDATE atomic (check + apply in one step) but lets the TEST decide the
 * order concurrent statements reach it, so every interleaving is covered
 * deterministically (all 120 orders of 3 completes + 2 cancels).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = { id: string; userId: string; status: string; completedAt: string | null; feedbackRating: number | null; updatedAt: string };
const db = { row: null as Row | null, pending: [] as Array<() => void>, applied: 0 };

vi.mock('@/lib/prisma', () => ({
  prisma: {
    rentalSession: {
      // Each updateMany parks until the test releases it, then runs atomically.
      updateMany: ({ where, data }: { where: { id: string; userId: string; status: string }; data: Record<string, unknown> }) =>
        new Promise<{ count: number }>((resolve) => {
          db.pending.push(() => {
            const r = db.row;
            if (!r || r.id !== where.id || r.userId !== where.userId || r.status !== where.status) return resolve({ count: 0 });
            for (const [k, v] of Object.entries(data)) if (v !== undefined) (r as unknown as Record<string, unknown>)[k] = v;
            db.applied += 1;
            resolve({ count: 1 });
          });
        }),
      findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
        db.row && db.row.id === where.id && db.row.userId === where.userId ? { ...db.row } : null,
    },
  },
}));
const analytics = vi.fn(async (_e: unknown) => ({}));
vi.mock('@/lib/analyticsEvents', () => ({ recordAnalyticsEvent: (e: unknown) => analytics(e) }));

const lib = () => import('@/lib/rentalSessions');
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const seed = (over: Partial<Row> = {}) => { db.row = { id: 'r1', userId: 'u1', status: 'active', completedAt: null, feedbackRating: null, updatedAt: 't0', ...over }; };
beforeEach(() => { db.row = null; db.pending = []; db.applied = 0; analytics.mockClear(); });

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

type Op = { kind: 'complete' | 'cancel'; rating?: number };
async function run(ops: Op[], order: number[]) {
  const { completeRentalSession, cancelRentalSession } = await lib();
  seed();
  db.applied = 0; db.pending = []; analytics.mockClear();
  const results = ops.map((op) => (op.kind === 'complete'
    ? completeRentalSession('u1', 'r1', { feedbackRating: op.rating })
    : cancelRentalSession('u1', 'r1')));
  await flush();
  expect(db.pending).toHaveLength(ops.length);          // every statement has been issued
  for (const i of order) { db.pending[i](); await flush(); }   // release in the chosen order
  return Promise.all(results);
}

describe('mutual exclusion — every interleaving', () => {
  const ops: Op[] = [
    { kind: 'complete', rating: 1 }, { kind: 'complete', rating: 2 }, { kind: 'complete', rating: 3 },
    { kind: 'cancel' }, { kind: 'cancel' },
  ];
  const orders = permutations([0, 1, 2, 3, 4]);

  it(`covers all ${orders.length} release orders of 3 completes + 2 cancels`, () => { expect(orders).toHaveLength(120); });

  it('exactly ONE terminal transition is ever applied, and the first statement through decides it', async () => {
    for (const order of orders) {
      const res = await run(ops, order);
      const winnerIdx = order[0];
      const winnerKind = ops[winnerIdx].kind;
      expect(db.applied, `order ${order}`).toBe(1);
      expect(db.row!.status, `order ${order}`).toBe(winnerKind === 'complete' ? 'completed' : 'cancelled');
      // Every attempt reports the WINNER's terminal state: same-kind attempts succeed,
      // opposite-kind attempts get the conflict (which carries that same state).
      const expectedKind = winnerKind === 'complete' ? 'completed' : 'cancelled';
      res.forEach((r, i) => expect(r.kind, `order ${order} op ${i}`).toBe(expectedKind));
    }
  });

  it('the loser never leaves its fields behind (no completion data on a cancelled rental)', async () => {
    for (const order of orders) {
      await run(ops, order);
      if (db.row!.status === 'cancelled') {
        expect(db.row!.completedAt).toBeNull();
        expect(db.row!.feedbackRating).toBeNull();
      } else {
        expect(db.row!.completedAt).not.toBeNull();
        // the FIRST completer's data stands — later completers never overwrite it
        const firstCompleter = order.find((i) => ops[i].kind === 'complete')!;
        expect(db.row!.feedbackRating).toBe(ops[firstCompleter].rating);
      }
    }
  });

  it('completion analytics fire exactly once when complete wins, never when cancel wins', async () => {
    for (const order of orders) {
      await run(ops, order);
      expect(analytics).toHaveBeenCalledTimes(db.row!.status === 'completed' ? 1 : 0);
    }
  });
});

describe('results for the two simple races', () => {
  it('complete first → complete succeeds, cancel reports completed (409 already_completed)', async () => {
    const [c, x] = await run([{ kind: 'complete', rating: 5 }, { kind: 'cancel' }], [0, 1]);
    expect(c).toMatchObject({ kind: 'completed', replayed: false });
    expect(x).toEqual({ kind: 'completed' });
    expect(db.row!.status).toBe('completed');
  });
  it('cancel first → cancel succeeds, complete reports cancelled (409 already_cancelled), nothing written', async () => {
    const [c, x] = await run([{ kind: 'complete', rating: 5 }, { kind: 'cancel' }], [1, 0]);
    expect(c).toEqual({ kind: 'cancelled' });
    expect(x).toMatchObject({ kind: 'cancelled' });
    expect(db.row!.status).toBe('cancelled');
    expect(db.row!.feedbackRating).toBeNull();
  });
});

describe('idempotency and ownership', () => {
  it('a later complete after a finished complete is a replay that changes nothing', async () => {
    const { completeRentalSession } = await lib();
    seed();
    const first = completeRentalSession('u1', 'r1', { feedbackRating: 4 });
    await flush(); db.pending[0](); await first;
    const second = completeRentalSession('u1', 'r1', { feedbackRating: 1 });
    await flush(); db.pending[1](); const r = await second;
    expect(r).toMatchObject({ kind: 'completed', replayed: true });
    expect(db.row!.feedbackRating).toBe(4);
    expect(db.applied).toBe(1);
    expect(analytics).toHaveBeenCalledTimes(1);
  });
  it("another user's rental is never completed or cancelled", async () => {
    const { completeRentalSession, cancelRentalSession } = await lib();
    seed({ userId: 'u2' });
    const a = completeRentalSession('u1', 'r1', {});
    const b = cancelRentalSession('u1', 'r1');
    await flush(); db.pending.forEach((f) => f());
    expect(await a).toEqual({ kind: 'not_found' });
    expect(await b).toEqual({ kind: 'not_found' });
    expect(db.row!.status).toBe('active');
    expect(db.applied).toBe(0);
  });
  it('complete and cancel on a missing rental are not_found', async () => {
    const { completeRentalSession, cancelRentalSession } = await lib();
    const a = completeRentalSession('u1', 'nope', {}); const b = cancelRentalSession('u1', 'nope');
    await flush(); db.pending.forEach((f) => f());
    expect(await a).toEqual({ kind: 'not_found' }); expect(await b).toEqual({ kind: 'not_found' });
  });
});

describe('the writes are single conditional statements (no read-then-update window)', () => {
  it('source: complete and cancel each issue one updateMany scoped by id + userId + status active', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('lib/rentalSessions.ts', 'utf8');
    const complete = src.slice(src.indexOf('export async function completeRentalSession'), src.indexOf('export function computeSessionStatus'));
    const cancel = src.slice(src.indexOf('export async function cancelRentalSession'));
    for (const body of [complete, cancel.slice(0, cancel.indexOf('\n}\n') + 3)]) {
      expect(body).toMatch(/updateMany\(\{\s*where: \{ id, userId, status: 'active' \}/);
      expect(body).not.toMatch(/rentalSession\.update\(/);
    }
  });
});
