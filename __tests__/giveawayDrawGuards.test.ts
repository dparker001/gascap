/**
 * WS-1 (Oct 31 emergency safeguards) — route + transaction behaviour.
 * docs/reviews/2026-10-05-drawing-integrity-rev4.md Part 1, amended by rev5 Part 1.
 *
 * The fake database below is transaction-faithful for what commitDraw relies
 * on: `GiveawayDraw.month` is unique (a second insert, committed or in flight,
 * fails with a real Prisma P2002), and an interactive transaction applies its
 * writes only if its callback resolves — a throw rolls everything back, as
 * Postgres does. Real-Postgres coverage waits for D11 (CI Postgres).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { Prisma } from '@/lib/generated/prisma/client';

// ── Fake DB ──────────────────────────────────────────────────────────────────
type DrawRow = { id: string; month: string; winnerId: string; winnerName: string; winnerEmail: string;
  entryCount: number; totalEntries: number; drawnAt: string; notes: string | null; claimToken: string | null;
  claimedAt?: string | null };
const db = {
  draws:    [] as DrawRow[],
  reserved: new Set<string>(),     // months held by an uncommitted insert (unique-index lock)
  resets:   0,                     // committed counter resets
  failReset: false,
  createDelayMs: 0,
};
const p2002 = () => new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`month`)', {
  code: 'P2002', clientVersion: 'test', meta: { modelName: 'GiveawayDraw', target: ['month'] },
});
function txClient(staged: { draws: DrawRow[]; resets: number; months: string[] }) {
  return {
    giveawayDraw: {
      create: async ({ data }: { data: DrawRow }) => {
        if (db.createDelayMs) await new Promise((r) => setTimeout(r, db.createDelayMs));
        if (db.reserved.has(data.month) || db.draws.some((d) => d.month === data.month)) throw p2002();
        db.reserved.add(data.month);
        staged.months.push(data.month);
        staged.draws.push({ ...data });
        return { ...data };
      },
    },
    user: {
      updateMany: async () => {
        await Promise.resolve();
        if (db.failReset) throw new Error('reset failed');
        staged.resets += 1;
        return { count: 3 };
      },
    },
  };
}
const prismaFake = {
  $transaction: async <T>(fn: (tx: ReturnType<typeof txClient>) => Promise<T>): Promise<T> => {
    const staged = { draws: [] as DrawRow[], resets: 0, months: [] as string[] };
    try {
      const out = await fn(txClient(staged));
      db.draws.push(...staged.draws);   // COMMIT
      db.resets += staged.resets;
      return out;
    } finally {
      for (const m of staged.months) db.reserved.delete(m);   // commit or ROLLBACK releases the lock
    }
  },
  giveawayDraw: {
    create:     vi.fn(async () => { throw new Error('non-transactional create must not be used for recording'); }),
    findMany:   async () => [...db.draws].sort((a, b) => b.drawnAt.localeCompare(a.drawnAt)),
    findUnique: async ({ where }: { where: { month: string } }) => db.draws.find((d) => d.month === where.month) ?? null,
  },
  user: {
    updateMany: vi.fn(async () => { throw new Error('non-transactional reset must not be used for recording'); }),
  },
};
vi.mock('@/lib/prisma', () => ({ prisma: prismaFake }));

// ── Collaborators ────────────────────────────────────────────────────────────
const runWeightedDraw = vi.fn();
vi.mock('@/lib/giveaway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/giveaway')>();
  return {
    ...actual,
    runWeightedDraw: (m: string) => runWeightedDraw(m),
    getCurrentPrizeTier: async () => ({ currentTier: { prize: '$50' }, nextTier: null, subscriberCount: 0, trialCount: 0 }),
  };
});
const fireDrawNotifications = vi.fn();
vi.mock('@/lib/drawNotifications', () => ({ fireDrawNotifications: (a: unknown) => fireDrawNotifications(a) }));
const sendMail = vi.fn(async (_a: unknown) => ({}));
vi.mock('@/lib/email', () => ({
  sendMail: (a: unknown) => sendMail(a), winnerNotificationEmailHtml: () => '', nonWinnerNotificationEmailHtml: () => '',
}));
vi.mock('@/lib/tremendous', () => ({ sendTremendousCard: vi.fn() }));
vi.mock('@/lib/users', () => ({ findById: vi.fn() }));
vi.mock('@/lib/apns', () => ({ sendApns: vi.fn(), apnsConfigured: () => false }));
vi.mock('@/lib/adminAuth', () => ({
  legacyAdminPasswordOk: () => true, sessionHasAdminRole: async () => false,
  requireAdmin: async () => ({ kind: 'legacy' }),
}));
const logAdminActionFor = vi.fn(async () => {});
vi.mock('@/lib/adminAudit', () => ({ logAdminActionFor: (...a: unknown[]) => logAdminActionFor(...(a as [])) }));

const drawResult = (month: string, who = 'u1') => ({
  month, totalEntries: 100, entrantCount: 10,
  winner: { userId: who, name: `Name ${who}`, email: `${who}@example.com`, entryCount: 7, loginCount: 1, lastLoginAt: null },
});
const seedDraw = (month: string) => db.draws.push({
  id: `id-${month}`, month, winnerId: 'w', winnerName: 'W', winnerEmail: 'w@example.com', entryCount: 1, totalEntries: 1,
  drawnAt: `${month}-28T00:00:00.000Z`, notes: null, claimToken: 'tok',
});

const OCT_CLOSE_PLUS_30S = '2026-11-01T04:00:30Z';

async function cron(query = '') {
  const { GET } = await import('@/app/api/cron/giveaway-draw/route');
  const res = await GET(new Request(`https://x/api/cron/giveaway-draw?secret=s${query}`));
  return { status: res.status, body: await res.json() };
}
async function admin(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/admin/sweepstakes/route');
  const res = await POST(new Request('https://x/api/admin/sweepstakes', { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  db.draws = []; db.reserved.clear(); db.resets = 0; db.failReset = false; db.createDelayMs = 0;
  runWeightedDraw.mockReset().mockImplementation(async (m: string) => drawResult(m));
  fireDrawNotifications.mockReset(); sendMail.mockClear(); logAdminActionFor.mockClear();
  prismaFake.giveawayDraw.create.mockClear(); prismaFake.user.updateMany.mockClear();
  process.env.CRON_SECRET = 's';
  process.env.ADMIN_PASSWORD = 'pw';
  delete process.env.GIVEAWAY_AUTO_DRAW;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(OCT_CLOSE_PLUS_30S));
});
afterEach(() => { vi.useRealTimers(); });

// ── 1. Fail-closed switch ────────────────────────────────────────────────────
describe('cron: GIVEAWAY_AUTO_DRAW fails closed', () => {
  for (const v of [undefined, '', 'off', 'ON', 'true', '1', ' on']) {
    it(`value ${JSON.stringify(v)} → skipped, nothing read or written`, async () => {
      if (v !== undefined) process.env.GIVEAWAY_AUTO_DRAW = v;
      const r = await cron();
      expect(r.body).toMatchObject({ ok: true, skipped: true, reason: 'auto-draw disabled' });
      expect(runWeightedDraw).not.toHaveBeenCalled();
      expect(db.draws).toHaveLength(0);
      expect(fireDrawNotifications).not.toHaveBeenCalled();
    });
  }
  it('?force=1 does not bypass the switch', async () => {
    const r = await cron('&force=1');
    expect(r.body.reason).toBe('auto-draw disabled');
    expect(runWeightedDraw).not.toHaveBeenCalled();
  });
  it('a wrong secret is still 401 before anything else', async () => {
    const { GET } = await import('@/app/api/cron/giveaway-draw/route');
    expect((await GET(new Request('https://x/api/cron/giveaway-draw?secret=nope'))).status).toBe(401);
  });
});

// ── 2–3. ET close + window ───────────────────────────────────────────────────
describe('cron with the switch on: ET close and 72h window', () => {
  beforeEach(() => { process.env.GIVEAWAY_AUTO_DRAW = 'on'; seedDraw('2026-09'); });

  it('Oct 31 7:50 PM EDT (the scheduled 23:50Z run) never draws October, even with force=1', async () => {
    vi.setSystemTime(new Date('2026-10-31T23:50:00Z'));
    const r = await cron('&force=1');
    expect(r.body).toMatchObject({ skipped: true, period: '2026-09', reason: 'already_drawn' });
    expect(runWeightedDraw).not.toHaveBeenCalled();
  });
  it('the delayed-run pattern that drew Aug/Sep early (Oct 31 01:39Z) cannot draw October', async () => {
    vi.setSystemTime(new Date('2026-10-31T01:39:37Z'));
    const r = await cron();
    expect(r.body.period).toBe('2026-09');
    expect(runWeightedDraw).not.toHaveBeenCalled();
  });
  it('after the ET close it draws October once, resets once, notifies once', async () => {
    const r = await cron();
    expect(r.body).toMatchObject({ ok: true, period: '2026-10' });
    expect(runWeightedDraw).toHaveBeenCalledWith('2026-10');
    expect(db.draws.map((d) => d.month).sort()).toEqual(['2026-09', '2026-10']);
    expect(db.resets).toBe(1);
    expect(fireDrawNotifications).toHaveBeenCalledTimes(1);
    expect(prismaFake.giveawayDraw.create).not.toHaveBeenCalled();
    expect(prismaFake.user.updateMany).not.toHaveBeenCalled();
  });
  it('a second run in the window is an idempotent skip', async () => {
    await cron();
    const r = await cron();
    expect(r.body.reason).toBe('already_drawn');
    expect(db.resets).toBe(1);
    expect(fireDrawNotifications).toHaveBeenCalledTimes(1);
  });
  it('day 4 after close with no draw → outside_auto_window, nothing drawn', async () => {
    vi.setSystemTime(new Date('2026-11-04T04:00:00Z'));
    const r = await cron();
    expect(r.body).toMatchObject({ skipped: true, period: '2026-10', reason: 'outside_auto_window' });
    expect(runWeightedDraw).not.toHaveBeenCalled();
    expect(db.resets).toBe(0);
  });
  it('a missed month is never drawn later — on Dec 2 it is November or nothing', async () => {
    vi.setSystemTime(new Date('2026-12-02T23:50:00Z'));
    const r = await cron();
    expect(r.body.period).toBe('2026-11');
    expect(runWeightedDraw).toHaveBeenCalledWith('2026-11');
    expect(runWeightedDraw).not.toHaveBeenCalledWith('2026-10');
  });
});

// ── 4. Atomic commit + race ──────────────────────────────────────────────────
describe('commitDraw: one draw per month, loser resets and notifies nothing', () => {
  it('two concurrent commits for one month: one inserted, one reset', async () => {
    db.createDelayMs = 5;
    const { commitDraw } = await import('@/lib/giveaway');
    const [a, b] = await Promise.all([commitDraw(drawResult('2026-10', 'u1') as never), commitDraw(drawResult('2026-10', 'u2') as never)]);
    expect([a.inserted, b.inserted].sort()).toEqual([false, true]);
    expect(db.draws.filter((d) => d.month === '2026-10')).toHaveLength(1);
    expect(db.resets).toBe(1);
  });
  it('P2002 is caught outside the rolled-back transaction and confirmed by re-reading the month', async () => {
    seedDraw('2026-10');
    const { commitDraw } = await import('@/lib/giveaway');
    expect(await commitDraw(drawResult('2026-10') as never)).toEqual({ inserted: false });
    expect(db.resets).toBe(0);
  });
  it('a P2002 that is not this month\'s draw is rethrown', async () => {
    const { commitDraw } = await import('@/lib/giveaway');
    const spy = vi.spyOn(prismaFake, '$transaction').mockRejectedValueOnce(p2002());
    await expect(commitDraw(drawResult('2026-10') as never)).rejects.toThrow(/Unique constraint/);
    spy.mockRestore();
  });
  it('a reset failure rolls the draw back (retryable) — no draw left with stale counters', async () => {
    db.failReset = true;
    const { commitDraw } = await import('@/lib/giveaway');
    await expect(commitDraw(drawResult('2026-10') as never)).rejects.toThrow('reset failed');
    expect(db.draws).toHaveLength(0);
    expect(db.reserved.size).toBe(0);
    db.failReset = false;
    expect((await commitDraw(drawResult('2026-10') as never)).inserted).toBe(true);
  });

  for (const [label, a, b] of [
    ['cron × cron', 'cron', 'cron'],
    ['cron × admin', 'cron', 'admin'],
    ['admin × admin', 'admin', 'admin'],
  ] as const) {
    it(`${label}: exactly one draw, one reset, one notification`, async () => {
      process.env.GIVEAWAY_AUTO_DRAW = 'on';
      db.createDelayMs = 5;
      const call = (k: 'cron' | 'admin') => (k === 'cron' ? cron() : admin({ month: '2026-10', holdEmails: false }));
      const [r1, r2] = await Promise.all([call(a), call(b)]);
      expect(db.draws.filter((d) => d.month === '2026-10')).toHaveLength(1);
      expect(db.resets).toBe(1);
      expect(fireDrawNotifications).toHaveBeenCalledTimes(1);
      const loser = [r1, r2].find((r) => r.body.skipped || r.status === 409)!;
      expect(loser.body.reason ?? loser.body.code).toBe('already_drawn');
    });
  }

  it('admin: reset failure → 500, nothing recorded, nothing sent', async () => {
    db.failReset = true;
    const r = await admin({ month: '2026-10', holdEmails: false });
    expect(r.status).toBe(500);
    expect(db.draws).toHaveLength(0);
    expect(fireDrawNotifications).not.toHaveBeenCalled();
  });
  it('cron: a draw lost to a concurrent request returns already_drawn (not a 500)', async () => {
    process.env.GIVEAWAY_AUTO_DRAW = 'on';
    runWeightedDraw.mockImplementation(async (m: string) => { seedDraw(m); return drawResult(m); });
    const r = await cron();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ skipped: true, reason: 'already_drawn' });
    expect(fireDrawNotifications).not.toHaveBeenCalled();
    expect(db.resets).toBe(0);
  });
});

// ── 5. Admin: explicit month, guard, late recovery (C1), notifications (C2) ─
describe('admin POST', () => {
  it('record without month → 400; nothing drawn (no UTC default)', async () => {
    const r = await admin({ holdEmails: true });
    expect(r.status).toBe(400);
    expect(runWeightedDraw).not.toHaveBeenCalled();
  });
  it('record of the open month → 422 month_open (panel shows the reason, not "already run")', async () => {
    const r = await admin({ month: '2026-11' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('month_open');
    expect(runWeightedDraw).not.toHaveBeenCalled();
  });
  it('record of October one second before the ET close → month_open', async () => {
    vi.setSystemTime(new Date('2026-11-01T03:59:59Z'));
    expect((await admin({ month: '2026-10' })).body.code).toBe('month_open');
  });
  it('record of a historical month (July) → 422 historical_month_requires_approval, even with a ref', async () => {
    const r = await admin({ month: '2026-07', lateDrawApprovalRef: 'approvals/2026-11-01-late-draw-2026-07.md', confirmMonth: '2026-07' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('historical_month_requires_approval');
    expect(db.draws).toHaveLength(0);
  });
  it('record of an already-drawn month → 409 with the existing draw', async () => {
    seedDraw('2026-10');
    const r = await admin({ month: '2026-10' });
    expect(r.status).toBe(409);
    expect(r.body.existing.month).toBe('2026-10');
  });
  it('in window: records, held by default, notes untouched', async () => {
    const r = await admin({ month: '2026-10', notes: 'Run-book step 3' });
    expect(r.status).toBe(200);
    expect(r.body.held).toBe(true);
    expect(db.draws[0].notes).toBe('Run-book step 3');
    expect(fireDrawNotifications).not.toHaveBeenCalled();
    expect(db.resets).toBe(1);
  });

  describe('late draw (after the 72h window) — C1', () => {
    beforeEach(() => vi.setSystemTime(new Date('2026-11-06T12:00:00Z')));
    const ref = 'approvals/2026-11-06-late-draw-2026-10.md';
    for (const bad of [undefined, 'a@b.com', 'approved by don', 'abc', 'x'.repeat(129)]) {
      it(`ref ${JSON.stringify(bad)?.slice(0, 20)} → 422 late_draw_requires_approval`, async () => {
        const r = await admin({ month: '2026-10', lateDrawApprovalRef: bad, confirmMonth: '2026-10' });
        expect(r.status).toBe(422);
        expect(r.body.code).toBe('late_draw_requires_approval');
        expect(runWeightedDraw).not.toHaveBeenCalled();
      });
    }
    it('mismatched confirmMonth → 422', async () => {
      const r = await admin({ month: '2026-10', lateDrawApprovalRef: ref, confirmMonth: '2026-11' });
      expect(r.body.code).toBe('late_draw_requires_approval');
    });
    it('valid ref + confirmMonth → records; original notes kept verbatim, ref appended', async () => {
      const notes = 'Verified winner  \nby phone';
      const r = await admin({ month: '2026-10', notes, lateDrawApprovalRef: ref, confirmMonth: '2026-10' });
      expect(r.status).toBe(200);
      const stored = db.draws[0].notes!;
      expect(stored.startsWith(notes)).toBe(true);
      expect(stored).toBe(`${notes}\n[late-draw-approval-ref: ${ref}; recorded 2026-11-06T12:00:00.000Z]`);
    });
  });

  describe('dry run (read-only, any month)', () => {
    it('requires a month', async () => {
      expect((await admin({ dryRun: true })).status).toBe(400);
    });
    it('previews an open month, labels it, writes nothing', async () => {
      const r = await admin({ month: '2026-11', dryRun: true });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ dryRun: true, monthState: 'open', withinAutoWindow: false });
      expect(db.draws).toHaveLength(0);
      expect(db.resets).toBe(0);
      expect(fireDrawNotifications).not.toHaveBeenCalled();
    });
    it('labels the closed month in its window', async () => {
      const r = await admin({ month: '2026-10', dryRun: true });
      expect(r.body).toMatchObject({ monthState: 'closed', withinAutoWindow: true });
    });
  });

  describe('send-winner-email — C2', () => {
    it('without month → 400, nothing dispatched (no UTC default)', async () => {
      seedDraw('2026-11'); // what the old UTC default would have resolved to
      const r = await admin({ action: 'send-winner-email' });
      expect(r.status).toBe(400);
      expect(fireDrawNotifications).not.toHaveBeenCalled();
    });
    it('with a month that has no draw → 404', async () => {
      const r = await admin({ month: '2026-10', action: 'send-winner-email' });
      expect(r.status).toBe(404);
      expect(fireDrawNotifications).not.toHaveBeenCalled();
    });
    it('with an existing draw → dispatched once for that month', async () => {
      seedDraw('2026-10');
      const r = await admin({ month: '2026-10', action: 'send-winner-email' });
      expect(r.status).toBe(200);
      expect(fireDrawNotifications).toHaveBeenCalledTimes(1);
      expect(fireDrawNotifications.mock.calls[0][0]).toMatchObject({ period: '2026-10' });
    });
  });

  it('PUT (alternate) and PATCH (claim) still require an explicit month', async () => {
    const { PUT, PATCH } = await import('@/app/api/admin/sweepstakes/route');
    expect((await PUT(new Request('https://x/api/admin/sweepstakes', { method: 'PUT', body: '{}' }))).status).toBe(400);
    expect((await PATCH(new Request('https://x/api/admin/sweepstakes', { method: 'PATCH' }))).status).toBe(400);
  });
  it('PUT (alternate) requires an existing draw for the month', async () => {
    const { PUT } = await import('@/app/api/admin/sweepstakes/route');
    const res = await PUT(new Request('https://x/api/admin/sweepstakes?month=2026-10', { method: 'PUT', body: '{}' }));
    expect(res.status).toBe(404);
  });
});

// ── Scope guards ─────────────────────────────────────────────────────────────
describe('scope', () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');
  it('only the giveaway-draw cron reads GIVEAWAY_AUTO_DRAW; the schedule is untouched', () => {
    expect(read('app/api/cron/giveaway-draw/route.ts')).toContain("process.env.GIVEAWAY_AUTO_DRAW !== 'on'");
    expect(read('.github/workflows/crons.yml')).not.toContain('GIVEAWAY_AUTO_DRAW');
    expect(read('.github/workflows/crons.yml')).toContain("cron: '50 23 * * *'  # giveaway-draw");
  });
  it('no force bypass, UTC last-day guard or direct record/reset remains in the draw routes', () => {
    for (const f of ['app/api/cron/giveaway-draw/route.ts', 'app/api/admin/sweepstakes/route.ts']) {
      const src = read(f);
      expect(src).not.toMatch(/searchParams\.get\('force'\)|isLastDayOfMonth|recordDraw\(|resetPeriodBonusEntries\(|currentMonth\(\)/);
    }
  });
  it('AMOE tags the ET Entry Month', () => {
    const src = read('app/api/amoe/route.ts');
    expect(src).toContain('const month = currentEntryMonthET();');
    expect(src).not.toMatch(/toISOString\(\)\.slice\(0, 7\)/);
  });
});
