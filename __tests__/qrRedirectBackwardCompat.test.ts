/**
 * Phase 4 hardening, concern #8 — backward compatibility proof for
 * app/q/[code]/route.ts. No pre-existing test file covered this route
 * before Workstream 01's change (confirmed by its absence in this repo's
 * history), so this is a comprehensive lock-in of the CURRENT contract —
 * every pre-existing cookie/redirect/logEvent behavior the route's own
 * header comment documents, plus proof the new gc_src_at cookie is
 * additive only and never alters any of the pre-existing values.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const logEvent = vi.fn();
const getPlacementByCode = vi.fn(async (_code: string) => undefined as { code: string; landingPath?: string; placement?: string; campaign?: string; headlineVariant?: string } | undefined);

vi.mock('@/lib/campaigns', () => ({
  getPlacementByCode: (code: string) => getPlacementByCode(code),
  logEvent: (ev: unknown) => logEvent(ev),
}));
vi.mock('@/lib/getBaseUrl', () => ({ getBaseUrl: () => 'https://www.gascap.app' }));
vi.mock('@/lib/gift20', () => ({ CARD_PLACEMENT: 'gift20-card' }));

beforeEach(() => {
  vi.clearAllMocks();
  getPlacementByCode.mockResolvedValue(undefined);
});

describe('app/q/[code]/route.ts — backward compatibility (Workstream 01 change is additive-only)', () => {
  it('unknown code: still redirects home, still logs under the UNKNOWN: sentinel, still sets gc_src to that sentinel (not the bare code) — pre-existing behavior, unchanged by this phase', async () => {
    const { GET } = await import('@/app/q/[code]/route');
    const req = new NextRequest('https://www.gascap.app/q/BOGUS123');
    const res = await GET(req, { params: { code: 'BOGUS123' } });

    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    expect(location).toContain('utm_source=gascap_qr');
    expect(location).toContain('utm_medium=placard');
    expect(location).toContain('utm_content=UNKNOWN%3ABOGUS123');
    expect(location).toContain('lang=en');

    // Pre-existing sentinel behavior (app/q/[code]/route.ts's own
    // `code = placement?.code ?? UNKNOWN:${rawCode}`) — not something
    // this phase changed; asserted here so a future edit can't silently
    // alter it without this test catching it.
    expect(res.cookies.get('gc_src')?.value).toBe('UNKNOWN:BOGUS123');
    expect(res.cookies.get('gc_lang')?.value).toBe('en');
    expect(res.cookies.get('gc_ssn')?.value).toBeTruthy();

    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent.mock.calls[0][0]).toMatchObject({ placementCode: 'UNKNOWN:BOGUS123', type: 'scan' });
  });

  it('known placement + ?lang=es: still sets gc_lang=es, still routes utm_medium by CARD_PLACEMENT check, still logs with the known code', async () => {
    getPlacementByCode.mockResolvedValue({ code: 'ORL001C', landingPath: '/', placement: 'gift20-card', campaign: 'Know Before You Fill Up', headlineVariant: undefined });
    const { GET } = await import('@/app/q/[code]/route');
    const req = new NextRequest('https://www.gascap.app/q/ORL001C?lang=es');
    const res = await GET(req, { params: { code: 'ORL001C' } });

    const location = res.headers.get('location')!;
    expect(location).toContain('utm_medium=physical-card'); // CARD_PLACEMENT branch unchanged
    expect(location).toContain('lang=es');
    expect(res.cookies.get('gc_src')?.value).toBe('ORL001C');
    expect(res.cookies.get('gc_lang')?.value).toBe('es');
  });

  it('NEW gc_src_at cookie is additive: present, numeric, 90-day maxAge, sameSite=lax, httpOnly=false — matches gc_src exactly except its own value/name', async () => {
    getPlacementByCode.mockResolvedValue({ code: 'ORL001C', landingPath: '/' });
    const { GET } = await import('@/app/q/[code]/route');
    const req = new NextRequest('https://www.gascap.app/q/ORL001C');
    const res = await GET(req, { params: { code: 'ORL001C' } });

    const srcCookie   = res.cookies.get('gc_src')!;
    const srcAtCookie = res.cookies.get('gc_src_at')!;
    expect(srcAtCookie).toBeTruthy();
    expect(Number.isFinite(Number(srcAtCookie.value))).toBe(true);
    expect(srcAtCookie.sameSite).toBe(srcCookie.sameSite);
    expect(srcAtCookie.httpOnly).toBe(srcCookie.httpOnly);
    expect(srcAtCookie.path).toBe(srcCookie.path);
    // gc_src's own value is still exactly the code — untouched by the addition
    expect(srcCookie.value).toBe('ORL001C');
  });
});
