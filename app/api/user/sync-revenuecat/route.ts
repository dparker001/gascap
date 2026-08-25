/**
 * POST /api/user/sync-revenuecat
 *
 * Server-authoritative reconciliation for the CURRENT authenticated user
 * only. Client RevenueCat CustomerInfo (returned by a local purchase/
 * restore call) is never itself sufficient proof of entitlement — see
 * app/upgrade/page.tsx's handleIap(). This endpoint lets the client ask
 * the server to confirm what RevenueCat's own API actually says before
 * navigating into any Lifetime-gated UI.
 *
 * Never accepts a userId/email from the request body — always resolves the
 * authenticated session to its canonical GasCap User row first, then uses
 * ONLY user.id for every RevenueCat call (never session.user.email as a
 * fallback identity — that's a display value, not the RevenueCat
 * app_user_id, and passing it in would silently query the wrong customer).
 *
 * Cross-account Lifetime ownership guard, fail-closed (2026-08-24): a
 * shared/reused Apple sandbox receipt can cause RevenueCat to report an
 * active Lifetime purchase under a DIFFERENT app_user_id than the one that
 * originally bought it (reproduced three times this session in sandbox).
 *
 * The invariant itself is enforced INSIDE reconcileRevenueCatState()
 * (lib/users.ts) — the single choke point every reconciliation caller goes
 * through, including webhook paths (syncRevenueCatEntitlementFromProvider,
 * used by CANCELLATION/REFUND_REVERSED). This route does not duplicate that
 * check; it only maps the typed errors reconcileRevenueCatState() throws to
 * HTTP responses:
 *   - CrossAccountLifetimeOwnershipError → 409, no identity disclosed.
 *   - UnverifiableLifetimeOwnershipError → 503, "try again."
 * Only Lifetime is guarded — Monthly carries no equivalent single-owner
 * non-consumable semantics, and this route never touches that behavior.
 *
 * Single authoritative fetch: fetchAuthoritativeRevenueCatState() is called
 * exactly ONCE. That same snapshot is handed to reconcileRevenueCatState()
 * for the write — no second provider read that could observe a different
 * state than what was validated (TOCTOU). The original account's
 * entitlement is never touched by this route, and stripeInterval is never
 * written here.
 *
 * Sandbox test-account allowlist (2026-08-25): TestFlight purchases are
 * created in Apple's SANDBOX environment, which the production-only lookup
 * above never sees by design — that's correct for every real user, but it
 * means no TestFlight purchase can ever reconcile. The ONLY exception is a
 * server-side allowlist of known tester emails (REVENUECAT_SANDBOX_TEST_EMAILS,
 * comma-separated, never hardcoded). The CURRENT AUTHENTICATED user's own
 * email — resolved server-side from the session, never from request input —
 * is checked against it; the client has no way to request or influence which
 * environment is queried. Everything else (ownership guard, single-snapshot
 * fetch, provenance) is identical for both environments.
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import {
  findById, findByEmail, reconcileRevenueCatState,
  CrossAccountLifetimeOwnershipError, UnverifiableLifetimeOwnershipError,
} from '@/lib/users';
import { fetchAuthoritativeRevenueCatState, isSandboxTestAccount } from '@/lib/revenueCatApi';

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  }

  // Resolve the canonical GasCap User row first — never pass an email
  // fallback into RevenueCat calls, which expect the canonical user.id
  // (the app_user_id every native purchase is configured with).
  const sessionId = (session.user as { id?: string }).id;
  const user = sessionId ? await findById(sessionId) : (session.user.email ? await findByEmail(session.user.email) : undefined);
  if (!user) {
    return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  }

  // Environment is decided ENTIRELY server-side from the authenticated
  // user's own canonical email — never from request body/query, so a client
  // can never ask for a sandbox lookup on someone else's behalf or its own.
  const environment = isSandboxTestAccount(user.email) ? 'sandbox' : 'production';

  try {
    // The ONE authoritative provider read for this request — reconcile
    // below uses this same snapshot, never re-fetching before persisting.
    const state = await fetchAuthoritativeRevenueCatState(user.id, environment);
    const resolved = await reconcileRevenueCatState(user.id, state);
    return NextResponse.json({
      pro:               resolved.pro,
      permanent:         resolved.permanent,
      effectiveInterval: resolved.effectiveInterval,
    });
  } catch (err) {
    if (err instanceof CrossAccountLifetimeOwnershipError) {
      console.error(`[GasCap] sync-revenuecat: ${err.message}`);
      return NextResponse.json(
        { error: 'This purchase is associated with another GasCap account.' },
        { status: 409 },
      );
    }
    if (err instanceof UnverifiableLifetimeOwnershipError) {
      console.error(`[GasCap] sync-revenuecat: ${err.message}`);
      return NextResponse.json(
        { error: "We couldn't verify ownership of this purchase yet." },
        { status: 503 },
      );
    }
    // A RevenueCat lookup failure must never be reported as "not
    // entitled" — that would let a transient provider/network issue
    // silently deny a genuine purchase. 503 (our/provider's fault), not
    // a definitive denial.
    console.error(`[GasCap] sync-revenuecat reconciliation failed for ${user.id}:`, err);
    return NextResponse.json({ error: 'Could not verify your purchase yet.' }, { status: 503 });
  }
}
