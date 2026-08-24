/**
 * lib/marketingBoost.ts — sendVacationIncentive() outcome classification.
 *
 * 2026-08-24 fix (ChatGPT review): the old {ok:boolean, error?} contract
 * collapsed a definitive provider rejection and a genuinely ambiguous
 * transport failure (fetch threw before any response was read) into the
 * same "false" value. That's unsafe for app/api/getaway/choose, which must
 * never treat an ambiguous outcome as safe to auto-transition to
 * manual_required (Marketing Boost may already have sent the certificate).
 *
 * Only sendVacationIncentive()'s contract changed — sendHotelSavingsCard()
 * and sendDiningVoucher() still return the original SendVacationResult
 * shape unchanged, since they're unrelated reward flows with no
 * durable-idempotency requirement driving this change.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  process.env.MARKETINGBOOST_API_KEY     = 'test-key';
  process.env.MARKETINGBOOST_BUSINESS_ID = 'test-business';
  process.env.MARKETINGBOOST_SENDER      = 'test-sender';
});

describe('sendVacationIncentive — outcome classification', () => {
  it('missing configuration → rejected (definitive, no request ever made)', async () => {
    delete process.env.MARKETINGBOOST_API_KEY;
    const { sendVacationIncentive } = await import('@/lib/marketingBoost');
    const result = await sendVacationIncentive({ destinationId: 'd1', name: 'A', email: 'a@example.com' });
    expect(result.outcome).toBe('rejected');
  });

  it('explicit parsed status:false → rejected, regardless of HTTP status code', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ status: false, errors: 'invalid destination' }), { status: 200 })) as unknown as typeof fetch;
    const { sendVacationIncentive } = await import('@/lib/marketingBoost');
    const result = await sendVacationIncentive({ destinationId: 'd1', name: 'A', email: 'a@example.com' });
    expect(result.outcome).toBe('rejected');
    if (result.outcome === 'rejected') expect(result.error).toBe('invalid destination');
  });

  it('successful provider response (status:true, res.ok) → sent', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ status: true, message: 'queued' }), { status: 200 })) as unknown as typeof fetch;
    const { sendVacationIncentive } = await import('@/lib/marketingBoost');
    const result = await sendVacationIncentive({ destinationId: 'd1', name: 'A', email: 'a@example.com' });
    expect(result.outcome).toBe('sent');
  });

  it('fetch throws (transport exception, no response ever read) → unknown, NEVER rejected', async () => {
    global.fetch = vi.fn(async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    const { sendVacationIncentive } = await import('@/lib/marketingBoost');
    const result = await sendVacationIncentive({ destinationId: 'd1', name: 'A', email: 'a@example.com' });
    expect(result.outcome).toBe('unknown');
  });

  it('200 + malformed JSON body → unknown, NEVER rejected', async () => {
    global.fetch = vi.fn(async () => new Response('not valid json{{{', { status: 200 })) as unknown as typeof fetch;
    const { sendVacationIncentive } = await import('@/lib/marketingBoost');
    const result = await sendVacationIncentive({ destinationId: 'd1', name: 'A', email: 'a@example.com' });
    expect(result.outcome).toBe('unknown');
  });

  it('200 + unreadable body (res.json() throws) → unknown', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => { throw new Error('body stream already read'); },
    })) as unknown as typeof fetch;
    const { sendVacationIncentive } = await import('@/lib/marketingBoost');
    const result = await sendVacationIncentive({ destinationId: 'd1', name: 'A', email: 'a@example.com' });
    expect(result.outcome).toBe('unknown');
  });

  it('ambiguous 5xx with a parseable-but-inconclusive body (no explicit status field) → unknown, NOT rejected', async () => {
    // Marketing Boost may have already processed the send before returning
    // a 500 — a body with no explicit status:false is not proof it didn't.
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ message: 'internal error' }), { status: 500 })) as unknown as typeof fetch;
    const { sendVacationIncentive } = await import('@/lib/marketingBoost');
    const result = await sendVacationIncentive({ destinationId: 'd1', name: 'A', email: 'a@example.com' });
    expect(result.outcome).toBe('unknown');
  });

  it('a 400 with no explicit status:false → unknown, NOT rejected (no definitive proof either way)', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ message: 'bad request' }), { status: 400 })) as unknown as typeof fetch;
    const { sendVacationIncentive } = await import('@/lib/marketingBoost');
    const result = await sendVacationIncentive({ destinationId: 'd1', name: 'A', email: 'a@example.com' });
    expect(result.outcome).toBe('unknown');
  });

  it('status:true but !res.ok (contradictory response) → unknown, not sent', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ status: true, message: 'queued' }), { status: 500 })) as unknown as typeof fetch;
    const { sendVacationIncentive } = await import('@/lib/marketingBoost');
    const result = await sendVacationIncentive({ destinationId: 'd1', name: 'A', email: 'a@example.com' });
    expect(result.outcome).toBe('unknown');
  });
});

describe('sendHotelSavingsCard / sendDiningVoucher — unaffected by the vacation-incentive contract change', () => {
  it('still return the original {ok, message?, error?} shape on success', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ status: true, message: 'sent' }), { status: 200 })) as unknown as typeof fetch;
    const { sendHotelSavingsCard, sendDiningVoucher } = await import('@/lib/marketingBoost');
    const hotel = await sendHotelSavingsCard({ fullName: 'A', email: 'a@example.com', amount: 100 });
    const dining = await sendDiningVoucher({ fullName: 'A', email: 'a@example.com', amount: 25 });
    expect(hotel).toEqual({ ok: true, message: 'sent' });
    expect(dining).toEqual({ ok: true, message: 'sent' });
  });

  it('still return {ok:false, error} on failure — no outcome/unknown classification introduced here', async () => {
    global.fetch = vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch;
    const { sendHotelSavingsCard } = await import('@/lib/marketingBoost');
    const result = await sendHotelSavingsCard({ fullName: 'A', email: 'a@example.com', amount: 100 });
    expect(result).toEqual({ ok: false, error: 'Error: down' });
  });
});
