/**
 * $20 Gift Campaign (docs/GIFT20_CAMPAIGN_SPEC.md) — regression coverage.
 *
 *   - /q/[code]: card placements get utm_medium=physical-card; station
 *     placards keep 'placard' (that route is live for placards).
 *   - /api/campaign/track: new cta_click / section_view events accept only
 *     allowlisted values and store only that one meta key; existing event
 *     types are untouched.
 *   - /api/campaign/lead: no marketing lead without explicit email consent;
 *     a phone number reaches GHL only with SMS consent.
 *   - Copy: EN/ES parity, and the compliance lines the page must never cross
 *     (no "free vacation", gift never framed as coupon/rebate/credit, no 🔥).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getPlacementByCode = vi.fn();
const logEvent           = vi.fn();
const upsertGhlContact   = vi.fn(async () => true);

vi.mock('@/lib/campaigns', () => ({
  getPlacementByCode: (...a: unknown[]) => getPlacementByCode(...a),
  logEvent:           (...a: unknown[]) => logEvent(...a),
}));
vi.mock('@/lib/ghl',    () => ({ upsertGhlContact: (...a: unknown[]) => upsertGhlContact(...(a as [])) }));
vi.mock('@/lib/getBaseUrl', () => ({ getBaseUrl: () => 'https://www.gascap.app' }));
vi.mock('next-auth',    () => ({ getServerSession: vi.fn(async () => null) }));
vi.mock('@/lib/auth',   () => ({ authOptions: {} }));

function placement(over: Record<string, unknown> = {}) {
  return {
    id: 'p1', code: 'GIFT01', campaign: '20dollar-gift', station: 'Don Parker — personal handout',
    placement: 'card', headlineVariant: 'GIFT20-v1', landingPath: '/gift/20',
    createdAt: '2026-10-01', active: true, ...over,
  };
}

function req(url: string, init: { body?: unknown; cookie?: string } = {}) {
  return new NextRequest(url, {
    method:  init.body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(init.cookie ? { cookie: init.cookie } : {}) },
    body:    init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

// ── /q/[code] ────────────────────────────────────────────────────────────────

describe('GET /q/[code] utm_medium', () => {
  async function scan(p: ReturnType<typeof placement>) {
    getPlacementByCode.mockResolvedValue(p);
    const { GET } = await import('@/app/q/[code]/route');
    const res = await GET(req(`https://www.gascap.app/q/${p.code}`), { params: { code: p.code } });
    return new URL(res.headers.get('location')!);
  }

  it('tags a handed-out card as physical-card and lands on /gift/20', async () => {
    const loc = await scan(placement());
    expect(loc.pathname).toBe('/gift/20');
    expect(loc.searchParams.get('utm_medium')).toBe('physical-card');
    expect(loc.searchParams.get('utm_campaign')).toBe('20dollar-gift');
    expect(loc.searchParams.get('utm_content')).toBe('GIFT01');
  });

  it('leaves station placards as placard', async () => {
    const loc = await scan(placement({ code: 'ORL001C', placement: 'counter', landingPath: '/' }));
    expect(loc.searchParams.get('utm_medium')).toBe('placard');
  });
});

// ── /api/campaign/track ──────────────────────────────────────────────────────

describe('POST /api/campaign/track', () => {
  async function post(body: unknown) {
    const { POST } = await import('@/app/api/campaign/track/route');
    return POST(req('https://www.gascap.app/api/campaign/track', { body, cookie: 'gc_src=GIFT03; gc_ssn=ssn_x' }));
  }

  it('logs an allowlisted cta_click with only the cta key', async () => {
    const res = await post({ type: 'cta_click', meta: { cta: 'web_lifetime', email: 'x@y.com' } });
    expect(res.status).toBe(200);
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent.mock.calls[0][0]).toMatchObject({ placementCode: 'GIFT03', type: 'cta_click', meta: { cta: 'web_lifetime' } });
    expect(logEvent.mock.calls[0][0].meta).toEqual({ cta: 'web_lifetime' });
  });

  it('rejects an unknown cta', async () => {
    const res = await post({ type: 'cta_click', meta: { cta: 'buy_now_or_else' } });
    expect(res.status).toBe(400);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('logs an allowlisted section_view and rejects an unknown section', async () => {
    expect((await post({ type: 'section_view', meta: { section: 'founder' } })).status).toBe(200);
    expect(logEvent.mock.calls[0][0].meta).toEqual({ section: 'founder' });
    expect((await post({ type: 'section_view', meta: { section: 'nope' } })).status).toBe(400);
    expect((await post({ type: 'section_view' })).status).toBe(400);
  });

  it('passes existing event types through unchanged', async () => {
    const res = await post({ type: 'calc_complete', meta: { mode: 'target_fill' } });
    expect(res.status).toBe(200);
    expect(logEvent.mock.calls[0][0]).toMatchObject({ type: 'calc_complete', meta: { mode: 'target_fill' } });
  });
});

// ── /api/campaign/lead ───────────────────────────────────────────────────────

describe('POST /api/campaign/lead consent', () => {
  async function post(body: unknown) {
    getPlacementByCode.mockResolvedValue(placement());
    const { POST } = await import('@/app/api/campaign/lead/route');
    return POST(req('https://www.gascap.app/api/campaign/lead', { body, cookie: 'gc_src=GIFT01' }));
  }

  it('refuses a lead without explicit email consent — nothing stored, nothing sent', async () => {
    const res = await post({ email: 'a@b.com', phone: '4075550100' });
    expect(res.status).toBe(400);
    expect(logEvent).not.toHaveBeenCalled();
    expect(upsertGhlContact).not.toHaveBeenCalled();
  });

  it('drops the phone number when SMS consent is absent', async () => {
    const res = await post({ email: 'a@b.com', phone: '4075550100', emailConsent: true });
    expect(res.status).toBe(200);
    const sent = (upsertGhlContact.mock.calls[0] as unknown[])[0] as { phone?: string; extraTags: string[] };
    expect(sent.phone).toBeUndefined();
    expect(sent.extraTags).not.toContain('gascap-sms-consent');
    expect(logEvent.mock.calls[0][0].meta).toMatchObject({ emailConsent: true, smsConsent: false, hasPhone: false });
  });

  it('forwards the phone and records consent when SMS consent is given', async () => {
    const res = await post({ email: 'a@b.com', phone: '4075550100', emailConsent: true, smsConsent: true });
    expect(res.status).toBe(200);
    const sent = (upsertGhlContact.mock.calls[0] as unknown[])[0] as { phone?: string; extraTags: string[] };
    expect(sent.phone).toBe('4075550100');
    expect(sent.extraTags).toEqual(expect.arrayContaining(['gascap-sms-consent', 'gascap-campaign-20dollar-gift', 'gascap-code-gift01']));
    expect(logEvent.mock.calls[0][0].meta.consentVersion).toMatch(/^gift20-v1/);
  });

  it('does not accept a truthy non-boolean as consent', async () => {
    expect((await post({ email: 'a@b.com', emailConsent: 'yes' })).status).toBe(400);
  });
});

// ── Codes + copy ─────────────────────────────────────────────────────────────

describe('gift20 codes and copy', () => {
  it('recognises card codes only', async () => {
    const { isGift20Code } = await import('@/lib/gift20');
    expect(isGift20Code('GIFT01')).toBe(true);
    expect(isGift20Code('gift10')).toBe(true);
    expect(isGift20Code('ORL001C')).toBe(false);
    expect(isGift20Code('GIFT1')).toBe(false);
    expect(isGift20Code(null)).toBe(false);
  });

  it('EN and ES have the same shape', async () => {
    const { translations } = await import('@/lib/translations');
    const shape = (o: unknown): unknown =>
      Array.isArray(o) ? o.map(shape) : o && typeof o === 'object'
        ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, shape(v)]))
        : typeof o;
    expect(shape(translations.es.gift20)).toEqual(shape(translations.en.gift20));
  });

  it('never crosses the compliance lines', async () => {
    const { translations } = await import('@/lib/translations');
    for (const loc of ['en', 'es'] as const) {
      const text = JSON.stringify(translations[loc].gift20);
      expect(text).not.toMatch(/🔥/);
      // "not a free vacation" is the required disclaimer; any other "free vacation" claim is not allowed
      expect(text.replace(/not a free vacation|No son vacaciones gratis/g, '')).not.toMatch(/free vacation|vacaciones gratis/i);
      expect(text).not.toMatch(/\$19\.95/);
      expect(text).not.toMatch(/\b(win|winner|ganador)\b/i);
    }
    // The gift is described as NOT a coupon/rebate/credit — and only in that sentence.
    const en = translations.en.gift20;
    expect(en.choiceFootnote).toMatch(/not a coupon, rebate, or credit/);
    expect(en.getawayTransition).toMatch(/only included with a Lifetime purchase/);
  });
});

// ── Per-card funnel ──────────────────────────────────────────────────────────

describe('buildGift20Funnel', () => {
  const ev = (o: Record<string, unknown>) => ({ id: 'e', ts: '2026-10-03T15:00:00Z', sessionId: 's1', ...o }) as never;

  it('counts per card, de-dupes section views by session, and only credits Lifetime to attributed signups', async () => {
    const { buildGift20Funnel } = await import('@/lib/gift20Funnel');
    const events = [
      ev({ placementCode: 'GIFT01', type: 'scan' }),
      ev({ placementCode: 'GIFT01', type: 'page_view' }),
      ev({ placementCode: 'GIFT01', type: 'section_view', meta: { section: 'founder' } }),
      ev({ placementCode: 'GIFT01', type: 'section_view', meta: { section: 'founder' } }), // same session again
      ev({ placementCode: 'GIFT01', type: 'cta_click', meta: { cta: 'app_store' } }),
      ev({ placementCode: 'GIFT01', type: 'signup', userId: 'u_life' }),
      ev({ placementCode: 'GIFT01', type: 'signup', userId: 'u_life' }),                 // a user counts once
      ev({ placementCode: 'gift02', type: 'scan', sessionId: 's2' }),
      ev({ placementCode: 'GIFT02', type: 'signup', sessionId: 's2', userId: 'u_free' }),
      ev({ placementCode: 'ORL001C', type: 'scan', sessionId: 's9' }),                   // placard: ignored
    ];
    const { rows, total } = buildGift20Funnel(events, new Set(['u_life', 'u_unattributed']));
    expect(rows.map((r) => r.code)).toEqual(['GIFT01', 'GIFT02']);
    const [g1, g2] = rows;
    expect(g1).toMatchObject({ scans: 1, sessions: 1, pageViews: 1, signups: 2, lifetimeBuyers: 1 });
    expect(g1.reached.founder).toBe(1);
    expect(g1.clicks.app_store).toBe(1);
    expect(g2).toMatchObject({ scans: 1, signups: 1, lifetimeBuyers: 0 });
    expect(total).toMatchObject({ code: 'TOTAL', scans: 2, lifetimeBuyers: 1 });
  });
});
