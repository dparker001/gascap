/**
 * Post-Sprint-2 Revision 1 fix — the getaway "choose your destination" email
 * fired from a RevenueCat lifetime grant must be durably one-time, not just
 * gated on event type. Before this fix: process crashes after the email is
 * queued but before the triggering webhook event is marked processed → a
 * RevenueCat retry of that same event re-runs the handler → the email is
 * sent a second time. Exactly the scenario named in the Sprint 2 review's
 * P0/P1 external-side-effect finding.
 *
 * Self-contained test file (separate from revenuecatWebhook.test.ts) so the
 * getaway-active mock can vary per test without touching that file's shared
 * setup used by 27 other cases.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const setUserPlan = vi.fn(async () => {});
const findById    = vi.fn(async (_id: string) => undefined as unknown);
const findByEmail = vi.fn(async (_e: string) => undefined as unknown);

vi.mock('@/lib/users', () => ({
  setUserPlan: (...a: unknown[]) => setUserPlan(...(a as [])),
  findById:    (id: string) => findById(id),
  findByEmail: (e: string) => findByEmail(e),
  enrollPaidCampaign: vi.fn(async () => {}),
  revokeRevenueCatEntitlement: vi.fn(async () => ({ pro: false, permanent: false, sources: [], trial: false, effectiveInterval: null })),
}));

const sendMail = vi.fn(async (_opts: { subject?: string }) => {});
vi.mock('@/lib/email', () => ({ sendMail: (opts: { subject?: string }) => sendMail(opts) }));
vi.mock('@/lib/emailCampaignPaid', () => ({ sendPaidCampaignEmail: vi.fn(async () => {}) }));
vi.mock('@/lib/userPush', () => ({ sendUserPush: vi.fn(async () => {}) }));
vi.mock('@/lib/getawayPromo', () => ({
  getawayPromoActive: () => true, // active for every test in this file
  GETAWAY_DISCLOSURE: { full: [], short: '' },
}));
// Mocked as a no-op — this file tests ONLY the getawayChooseEmailSentAt
// claim's own idempotency (maybeSendGetaway). stampGetawayHoldUntil() uses
// a SEPARATE conditional column (getawayHoldUntil) via its own updateMany
// call; letting the real module run here would otherwise collide with this
// file's single-column `claimedUsers` stand-in below and falsely appear to
// have already claimed the getaway-email send. See
// __tests__/getawayFulfillment.test.ts for stampGetawayHoldUntil's own coverage.
vi.mock('@/lib/getawayFulfillment', () => ({
  stampGetawayHoldUntil: vi.fn(async () => {}),
  maybeRevokeGetawayQualification: vi.fn(async () => {}),
}));

// Real check-and-set semantics: only the FIRST claim on a given user id wins.
const claimedUsers = new Set<string>();
type UpdateManyArgs = { where: { id: string; getawayChooseEmailSentAt: null } };
const userUpdateMany = vi.fn(async ({ where }: UpdateManyArgs) => {
  if (claimedUsers.has(where.id)) return { count: 0 };
  claimedUsers.add(where.id);
  return { count: 1 };
});
vi.mock('@/lib/prisma', () => ({ prisma: { user: { updateMany: (args: UpdateManyArgs) => userUpdateMany(args) } } }));

const eventStore = new Map<string, { status: string }>();
vi.mock('@/lib/revenueCatEvents', () => ({
  claimEvent: vi.fn(async (eventId: string) => {
    // Every delivery (even of the "same" event) is treated as claimable here
    // — this test is specifically about the getaway-email marker being the
    // thing that prevents duplication, independent of event-level dedup, to
    // isolate the two protections from each other.
    eventStore.set(eventId, { status: 'processing' });
    return { outcome: 'claimed', claimToken: `tok-${eventId}` };
  }),
  markProcessed: vi.fn(async () => {}),
  markFailed:    vi.fn(async () => {}),
}));

const SECRET = 'test-secret';

async function post(body: unknown) {
  const { POST } = await import('@/app/api/native/revenuecat/route');
  const req = new Request('https://www.gascap.app/api/native/revenuecat', {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json', authorization: SECRET }),
    body: JSON.stringify(body),
  });
  return POST(req);
}

const USER = { id: 'user-1', email: 'buyer@example.com', name: 'Buyer', plan: 'free' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  eventStore.clear();
  claimedUsers.clear();
  process.env.REVENUECAT_WEBHOOK_AUTH = SECRET;
  findById.mockResolvedValue(USER);
});

describe('getaway choose-email durable idempotency', () => {
  it('sends the getaway email on a genuine first lifetime purchase', async () => {
    await post({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'user-1', product_id: 'gascap_pro_lifetime', id: 'evt_1' } });
    expect(sendMail).toHaveBeenCalled();
    expect(userUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('a retry of the SAME event (simulating a crash-before-markProcessed) does NOT send a second getaway email', async () => {
    // First delivery — process the grant and "crash" conceptually right
    // after (this mock's claimEvent always returns 'claimed' regardless of
    // repeat id, standing in for the crash-before-markProcessed window).
    await post({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'user-1', product_id: 'gascap_pro_lifetime', id: 'evt_retry' } });
    expect(sendMail).toHaveBeenCalledTimes(2); // admin notify + buyer choose-email

    // Retry of the same event.
    await post({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'user-1', product_id: 'gascap_pro_lifetime', id: 'evt_retry' } });
    // The durable marker must have blocked the second send — sendMail is
    // still called (once, for the admin notification path in the first
    // delivery only) exactly once total across both deliveries' getaway
    // buyer email specifically.
    const buyerEmailSends = sendMail.mock.calls.filter((c) => c[0]?.subject?.includes('complimentary getaway'));
    expect(buyerEmailSends.length).toBe(1);
  });

  it('a genuinely different user is not blocked by another user\'s claim', async () => {
    await post({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'user-1', product_id: 'gascap_pro_lifetime', id: 'evt_u1' } });
    findById.mockResolvedValue({ ...USER, id: 'user-2', email: 'other@example.com' });
    await post({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'user-2', product_id: 'gascap_pro_lifetime', id: 'evt_u2' } });
    const buyerEmailSends = sendMail.mock.calls.filter((c) => c[0]?.subject?.includes('complimentary getaway'));
    expect(buyerEmailSends.length).toBe(2);
  });
});
