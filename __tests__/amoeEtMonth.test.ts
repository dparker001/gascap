/**
 * WS-1: free-entry (AMOE) submissions are tagged with the EASTERN Entry Month,
 * and the one-per-person-per-month limit uses that same month. The UTC month
 * filed 8 PM–midnight ET submissions on the last day under the next month.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AmoeEntry } from '@/lib/amoeEntries';

let store: AmoeEntry[] = [];
vi.mock('@/lib/amoeEntries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/amoeEntries')>();
  return {
    ...actual,
    readAmoeEntries: () => store.map((e) => ({ ...e })),
    writeAmoeEntries: (e: AmoeEntry[]) => { store = e.map((x) => ({ ...x })); },
  };
});
const mirror = vi.fn(async (_e: AmoeEntry) => {});
vi.mock('@/lib/amoeEntriesDb', () => ({ mirrorAmoeEntryToDb: (e: AmoeEntry) => mirror(e) }));

async function submit(email = 'Pat@Example.com') {
  const { POST } = await import('@/app/api/amoe/route');
  const req = new Request('https://x/api/amoe', {
    method: 'POST', body: JSON.stringify({ firstName: 'Pat', lastName: 'Lee', email }),
  });
  const res = await POST(req as never);
  return { status: res.status, body: await res.json() };
}

beforeEach(() => { store = []; mirror.mockClear(); vi.useFakeTimers({ toFake: ['Date'] }); });
afterEach(() => vi.useRealTimers());

describe('AMOE Entry Month is Eastern Time', () => {
  it('Oct 31 11:59:59 PM EDT (2026-11-01T03:59:59Z) counts for October', async () => {
    vi.setSystemTime(new Date('2026-11-01T03:59:59Z'));
    expect((await submit()).status).toBe(200);
    expect(store[0].month).toBe('2026-10');
  });
  it('Oct 31 8:00 PM EDT — already November in UTC — counts for October', async () => {
    vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
    await submit();
    expect(store[0].month).toBe('2026-10');
  });
  it('Nov 1 12:00:00 AM EDT (04:00:00Z) counts for November', async () => {
    vi.setSystemTime(new Date('2026-11-01T04:00:00Z'));
    await submit();
    expect(store[0].month).toBe('2026-11');
  });
  it('Nov 30 11:59:59 PM EST (2026-12-01T04:59:59Z) counts for November', async () => {
    vi.setSystemTime(new Date('2026-12-01T04:59:59Z'));
    await submit();
    expect(store[0].month).toBe('2026-11');
  });

  it('one per person per ET month: a second entry the same ET month is refused', async () => {
    vi.setSystemTime(new Date('2026-10-31T23:00:00Z'));            // 7 PM EDT Oct 31
    expect((await submit()).status).toBe(200);
    vi.setSystemTime(new Date('2026-11-01T03:00:00Z'));            // 11 PM EDT Oct 31 (UTC: Nov)
    expect((await submit('pat@example.com ')).status).toBe(409);
    expect(store).toHaveLength(1);
  });
  it('a new ET month allows a new entry', async () => {
    vi.setSystemTime(new Date('2026-11-01T03:00:00Z'));
    await submit();
    vi.setSystemTime(new Date('2026-11-01T04:00:01Z'));
    expect((await submit()).status).toBe(200);
    expect(store.map((e) => e.month)).toEqual(['2026-10', '2026-11']);
  });
});
