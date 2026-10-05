/**
 * Account-scoped loading of the signed-in user's open rentals (used by
 * hooks/useRentalSessions.ts). Open rentals are personal data, so:
 *  - the data is KEYED to the user id it was fetched for and is only ever
 *    exposed to that same user (`sessionsForUser`) — a render after an account
 *    switch or logout can never show the previous account's rentals, even for
 *    a frame;
 *  - every request is cancellable and its result is applied only if it is
 *    still the current one — a slow response for account A that lands after
 *    the user became B (or logged out) is discarded.
 */
import type { RentalSession } from './rentalSessions';

export interface ScopedSessions { userId: string | null; sessions: RentalSession[] }
export const EMPTY_SCOPED: ScopedSessions = { userId: null, sessions: [] };

export function sessionsForUser(state: ScopedSessions, userId: string | null | undefined): RentalSession[] {
  return userId && state.userId === userId ? state.sessions : [];
}

/** True while an authenticated user's data has not arrived yet (never for a signed-out user). */
export function isLoadingFor(state: ScopedSessions, authenticated: boolean, userId: string | null | undefined): boolean {
  return authenticated && !!userId && state.userId !== userId;
}

/**
 * Fetches the user's open rentals. Returns a cancel function; after it is
 * called (or the signal aborts) NO callback runs. A failed or non-OK response
 * resolves to an empty list for that user, as before.
 */
export function startRentalSessionsLoad(
  userId: string,
  fetchImpl: (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>,
  onLoaded: (state: ScopedSessions) => void,
): () => void {
  const abort = new AbortController();
  let cancelled = false;
  void (async () => {
    let sessions: RentalSession[] = [];
    try {
      const res = await fetchImpl('/api/rental-sessions?status=active', { signal: abort.signal });
      if (res.ok) sessions = ((await res.json()) as { sessions?: RentalSession[] } | null)?.sessions ?? [];
    } catch { /* aborted or failed → treated as no rentals, only if still current */ }
    if (cancelled || abort.signal.aborted) return;
    onLoaded({ userId, sessions });
  })();
  return () => { cancelled = true; abort.abort(); };
}
