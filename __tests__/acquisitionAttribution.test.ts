/**
 * Workstream 01 — regression coverage for lib/acquisitionAttribution.ts.
 *
 * Covers: chronological precedence (never "QR always wins"), the
 * ambiguity path (never inventing a winner), concurrency/write-once
 * (the UPDATE's WHERE clause is the actual atomicity mechanism — Postgres
 * guarantees a conditional UPDATE is atomic; this test proves the
 * application code issues that exact conditional, not a read-then-write),
 * malformed data, and missing/expired-equivalent (absent) cookies.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const userUpdateMany = vi.fn(async (_args: unknown) => ({ count: 1 }));
const campaignCodeFindUnique = vi.fn(async (_args: unknown) => null as { code: string; active: boolean } | null);

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      updateMany: (args: unknown) => userUpdateMany(args),
    },
    acquisitionCampaignCode: {
      findUnique: (args: unknown) => campaignCodeFindUnique(args),
    },
  },
}));

const getPlacementByCode = vi.fn(async (_code: string) => undefined as { code: string } | undefined);
vi.mock('@/lib/campaigns', () => ({
  getPlacementByCode: (code: string) => getPlacementByCode(code),
}));

beforeEach(() => {
  vi.clearAllMocks();
  userUpdateMany.mockResolvedValue({ count: 1 });
  campaignCodeFindUnique.mockResolvedValue(null);
  getPlacementByCode.mockResolvedValue(undefined);
});

describe('parseCookieHeader', () => {
  it('parses multiple cookies from a real header', async () => {
    const { parseCookieHeader } = await import('@/lib/acquisitionAttribution');
    const out = parseCookieHeader('gc_src=ABC123; gc_src_at=1700000000000; other=x');
    expect(out).toEqual({ gc_src: 'ABC123', gc_src_at: '1700000000000', other: 'x' });
  });

  it('returns {} for a null/undefined/empty header', async () => {
    const { parseCookieHeader } = await import('@/lib/acquisitionAttribution');
    expect(parseCookieHeader(null)).toEqual({});
    expect(parseCookieHeader(undefined)).toEqual({});
    expect(parseCookieHeader('')).toEqual({});
  });
});

describe('isSyntacticallyValidUtmCode', () => {
  it('accepts lowercase letters, digits, hyphen, underscore, 1-64 chars', async () => {
    const { isSyntacticallyValidUtmCode } = await import('@/lib/acquisitionAttribution');
    expect(isSyntacticallyValidUtmCode('meta-oct2026')).toBe(true);
    expect(isSyntacticallyValidUtmCode('a')).toBe(true);
    expect(isSyntacticallyValidUtmCode('a'.repeat(64))).toBe(true);
  });

  it('rejects uppercase, spaces, punctuation beyond -/_, empty, and over-length', async () => {
    const { isSyntacticallyValidUtmCode } = await import('@/lib/acquisitionAttribution');
    expect(isSyntacticallyValidUtmCode('META')).toBe(false);
    expect(isSyntacticallyValidUtmCode('meta oct')).toBe(false);
    expect(isSyntacticallyValidUtmCode('meta.oct')).toBe(false);
    expect(isSyntacticallyValidUtmCode('')).toBe(false);
    expect(isSyntacticallyValidUtmCode('a'.repeat(65))).toBe(false);
  });
});

describe('resolveFirstTouch — chronological precedence, never "QR always wins"', () => {
  // A fixed, realistic "now" anchor — tests pass this explicitly so they
  // don't depend on the real wall clock, and so small relative offsets
  // (T0+1000 vs T0+2000) land well inside the plausible-timestamp window
  // the Phase 4 hardening checks against (parseTimestampMs's bounds are
  // relative to "now", not to the epoch — see below).
  const T0 = 1_700_000_000_000;
  const NOW_FOR_PRECEDENCE = T0 + 10_000;

  it('neither channel valid -> null source, not ambiguous', async () => {
    const { resolveFirstTouch } = await import('@/lib/acquisitionAttribution');
    expect(resolveFirstTouch({ qrValid: null, qrAt: null, utmValid: null, utmAt: null }))
      .toEqual({ source: null, campaign: null, ambiguous: false });
  });

  it('only QR valid -> qr wins unconditionally, no timestamp needed', async () => {
    const { resolveFirstTouch } = await import('@/lib/acquisitionAttribution');
    expect(resolveFirstTouch({ qrValid: 'PLACARD1', qrAt: null, utmValid: null, utmAt: null }))
      .toEqual({ source: 'qr', campaign: 'PLACARD1', ambiguous: false });
  });

  it('only UTM valid -> utm wins unconditionally, no timestamp needed', async () => {
    const { resolveFirstTouch } = await import('@/lib/acquisitionAttribution');
    expect(resolveFirstTouch({ qrValid: null, qrAt: null, utmValid: 'meta-oct', utmAt: null }))
      .toEqual({ source: 'utm', campaign: 'meta-oct', ambiguous: false });
  });

  it('both valid, QR strictly earlier -> QR wins (chronological, not channel priority)', async () => {
    const { resolveFirstTouch } = await import('@/lib/acquisitionAttribution');
    expect(resolveFirstTouch({ qrValid: 'PLACARD1', qrAt: String(T0 + 1000), utmValid: 'meta-oct', utmAt: String(T0 + 2000) }, NOW_FOR_PRECEDENCE))
      .toEqual({ source: 'qr', campaign: 'PLACARD1', ambiguous: false });
  });

  it('both valid, UTM strictly earlier -> UTM wins (proves QR does NOT always win)', async () => {
    const { resolveFirstTouch } = await import('@/lib/acquisitionAttribution');
    expect(resolveFirstTouch({ qrValid: 'PLACARD1', qrAt: String(T0 + 2000), utmValid: 'meta-oct', utmAt: String(T0 + 1000) }, NOW_FOR_PRECEDENCE))
      .toEqual({ source: 'utm', campaign: 'meta-oct', ambiguous: false });
  });

  it('both valid, EQUAL timestamps -> ambiguous, no winner invented', async () => {
    const { resolveFirstTouch } = await import('@/lib/acquisitionAttribution');
    expect(resolveFirstTouch({ qrValid: 'PLACARD1', qrAt: String(T0 + 1500), utmValid: 'meta-oct', utmAt: String(T0 + 1500) }, NOW_FOR_PRECEDENCE))
      .toEqual({ source: null, campaign: null, ambiguous: true });
  });

  it('both valid, QR timestamp MISSING -> ambiguous, not "UTM wins by default"', async () => {
    const { resolveFirstTouch } = await import('@/lib/acquisitionAttribution');
    expect(resolveFirstTouch({ qrValid: 'PLACARD1', qrAt: null, utmValid: 'meta-oct', utmAt: String(T0 + 1000) }, NOW_FOR_PRECEDENCE))
      .toEqual({ source: null, campaign: null, ambiguous: true });
  });

  it('both valid, UTM timestamp MALFORMED (non-numeric) -> ambiguous, never treated as 0/Infinity', async () => {
    const { resolveFirstTouch } = await import('@/lib/acquisitionAttribution');
    expect(resolveFirstTouch({ qrValid: 'PLACARD1', qrAt: '1000', utmValid: 'meta-oct', utmAt: 'not-a-number' }))
      .toEqual({ source: null, campaign: null, ambiguous: true });
  });

  it('both valid, QR timestamp is zero/negative -> treated as missing, ambiguous (never invented as "earliest possible")', async () => {
    const { resolveFirstTouch } = await import('@/lib/acquisitionAttribution');
    expect(resolveFirstTouch({ qrValid: 'PLACARD1', qrAt: '0', utmValid: 'meta-oct', utmAt: '1000' }).ambiguous).toBe(true);
    expect(resolveFirstTouch({ qrValid: 'PLACARD1', qrAt: '-5', utmValid: 'meta-oct', utmAt: '1000' }).ambiguous).toBe(true);
  });

  // Phase 4 hardening, concern #5 — cookie tampering / timestamp
  // manipulation. A forged timestamp that is implausibly old (older than
  // the cookie's own 90-day maxAge — the browser would have dropped a
  // genuine cookie by then) or implausibly in the future (both
  // timestamps are stamped server-side; a client has no legitimate way
  // to be "ahead" of the server) is rejected as unparseable, exactly like
  // a malformed string — never trusted, never used to force a win.
  const NOW = 1_700_000_000_000;
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

  it('rejects a timestamp older than the cookie max-age as implausible (forged-ancient-cookie attack)', async () => {
    const { resolveFirstTouch } = await import('@/lib/acquisitionAttribution');
    const ancientQrAt = String(NOW - NINETY_DAYS_MS - 1000); // 1s past the 90-day window
    const result = resolveFirstTouch({ qrValid: 'PLACARD1', qrAt: ancientQrAt, utmValid: 'meta-oct', utmAt: String(NOW) }, NOW);
    expect(result).toEqual({ source: null, campaign: null, ambiguous: true });
  });

  it('accepts a timestamp exactly at the 90-day boundary (not off-by-one too strict)', async () => {
    const { resolveFirstTouch } = await import('@/lib/acquisitionAttribution');
    const boundaryQrAt = String(NOW - NINETY_DAYS_MS + 1000); // 1s inside the window
    const result = resolveFirstTouch({ qrValid: 'PLACARD1', qrAt: boundaryQrAt, utmValid: 'meta-oct', utmAt: String(NOW) }, NOW);
    expect(result).toEqual({ source: 'qr', campaign: 'PLACARD1', ambiguous: false });
  });

  it('rejects a timestamp meaningfully in the future as implausible (forged-future-cookie attack)', async () => {
    const { resolveFirstTouch } = await import('@/lib/acquisitionAttribution');
    const futureUtmAt = String(NOW + 10 * 60 * 1000); // 10 minutes ahead — beyond the 5-minute skew tolerance
    const result = resolveFirstTouch({ qrValid: 'PLACARD1', qrAt: String(NOW), utmValid: 'meta-oct', utmAt: futureUtmAt }, NOW);
    expect(result).toEqual({ source: null, campaign: null, ambiguous: true });
  });

  it('tolerates a small, ordinary clock-skew future timestamp (not overly strict)', async () => {
    const { resolveFirstTouch } = await import('@/lib/acquisitionAttribution');
    const slightlyAheadUtmAt = String(NOW + 60 * 1000); // 1 minute ahead — within tolerance
    const result = resolveFirstTouch({ qrValid: 'PLACARD1', qrAt: String(NOW - 1000), utmValid: 'meta-oct', utmAt: slightlyAheadUtmAt }, NOW);
    expect(result).toEqual({ source: 'qr', campaign: 'PLACARD1', ambiguous: false });
  });
});

describe('captureAcquisitionAttributionFromRawTouch — DB integration (mocked)', () => {
  it('missing/absent cookies on both channels -> zero DB calls at all', async () => {
    const { captureAcquisitionAttributionFromRawTouch } = await import('@/lib/acquisitionAttribution');
    await captureAcquisitionAttributionFromRawTouch('user_1', { qrCode: null, qrAt: null, utmCode: null, utmAt: null });
    expect(getPlacementByCode).not.toHaveBeenCalled();
    expect(campaignCodeFindUnique).not.toHaveBeenCalled();
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it('write-once: the UPDATE is issued with acqCapturedAt:null in WHERE — the actual atomicity mechanism', async () => {
    getPlacementByCode.mockResolvedValue({ code: 'PLACARD1' });
    const { captureAcquisitionAttributionFromRawTouch } = await import('@/lib/acquisitionAttribution');
    await captureAcquisitionAttributionFromRawTouch('user_1', { qrCode: 'PLACARD1', qrAt: '1000', utmCode: null, utmAt: null });
    expect(userUpdateMany).toHaveBeenCalledTimes(1);
    const call = userUpdateMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(call.where).toEqual({ id: 'user_1', acqCapturedAt: null });
  });

  it('unregistered QR code (not found in CampaignPlacement) is never written', async () => {
    getPlacementByCode.mockResolvedValue(undefined);
    const { captureAcquisitionAttributionFromRawTouch } = await import('@/lib/acquisitionAttribution');
    await captureAcquisitionAttributionFromRawTouch('user_1', { qrCode: 'FORGED', qrAt: '1000', utmCode: null, utmAt: null });
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it('syntactically invalid UTM code never reaches the registry lookup or a write', async () => {
    const { captureAcquisitionAttributionFromRawTouch } = await import('@/lib/acquisitionAttribution');
    await captureAcquisitionAttributionFromRawTouch('user_1', { qrCode: null, qrAt: null, utmCode: 'HAS SPACES AND CAPS!', utmAt: '1000' });
    expect(campaignCodeFindUnique).not.toHaveBeenCalled();
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it('syntactically valid but unregistered/inactive UTM code is never written', async () => {
    campaignCodeFindUnique.mockResolvedValue(null); // not found
    const { captureAcquisitionAttributionFromRawTouch } = await import('@/lib/acquisitionAttribution');
    await captureAcquisitionAttributionFromRawTouch('user_1', { qrCode: null, qrAt: null, utmCode: 'unregistered-code', utmAt: '1000' });
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it('ambiguous double-touch still writes acqAmbiguous:true with null source/campaign, never a guessed winner', async () => {
    getPlacementByCode.mockResolvedValue({ code: 'PLACARD1' });
    campaignCodeFindUnique.mockResolvedValue({ code: 'meta-oct', active: true });
    const { captureAcquisitionAttributionFromRawTouch } = await import('@/lib/acquisitionAttribution');
    await captureAcquisitionAttributionFromRawTouch('user_1', { qrCode: 'PLACARD1', qrAt: '1500', utmCode: 'meta-oct', utmAt: '1500' });
    expect(userUpdateMany).toHaveBeenCalledTimes(1);
    const call = userUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data).toMatchObject({ acqSource: null, acqCampaign: null, acqAmbiguous: true });
    expect(call.data.acqCapturedAt).toBeTruthy(); // the touch itself is still recorded
  });

  it('valid single UTM touch resolves and writes correctly', async () => {
    campaignCodeFindUnique.mockResolvedValue({ code: 'meta-oct', active: true });
    const { captureAcquisitionAttributionFromRawTouch } = await import('@/lib/acquisitionAttribution');
    await captureAcquisitionAttributionFromRawTouch('user_1', { qrCode: null, qrAt: null, utmCode: 'meta-oct', utmAt: '1000' });
    const call = userUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data).toMatchObject({ acqSource: 'utm', acqCampaign: 'meta-oct', acqAmbiguous: false });
  });
});
