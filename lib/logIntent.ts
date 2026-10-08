/**
 * P1-A — one-shot "open the fill-up logger" intent, used by the `/?log=1`
 * deep link (first-fill-up nudge email and push).
 *
 * The link used to land on the home page and be ignored: nothing read `log`.
 * The intent is now (1) stripped from the URL as soon as it is handled — so
 * a reload or back/forward never reopens the logger — and (2) held in module
 * memory until the logger consumes it exactly once. A short TTL means an
 * intent that nothing consumed (e.g. the logger never mounted) cannot pop the
 * logger open minutes later.
 *
 * Pure helpers here are DB- and DOM-free so they unit-test in node.
 */

export const LOG_INTENT_PARAM = 'log';
export const LOG_INTENT_EVENT = 'gascap:log-intent';
export const LOG_INTENT_TTL_MS = 15_000;

/** True iff the query string carries the log intent (`log=1`). */
export function hasLogIntent(search: string): boolean {
  return new URLSearchParams(search).get(LOG_INTENT_PARAM) === '1';
}

/**
 * Returns `search` with the log intent removed, every other parameter
 * preserved in order. Returns the input unchanged when there is no intent, so
 * callers can compare and skip a no-op history write.
 */
export function stripLogIntent(search: string): string {
  const params = new URLSearchParams(search);
  if (params.get(LOG_INTENT_PARAM) !== '1') return search;
  params.delete(LOG_INTENT_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

let pendingAt: number | null = null;

/** Record a pending intent and notify any already-mounted logger. */
export function requestLogIntent(now: number = Date.now()): void {
  pendingAt = now;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LOG_INTENT_EVENT));
}

/** Is an unexpired intent waiting? Does not consume it. */
export function peekLogIntent(now: number = Date.now()): boolean {
  return pendingAt !== null && now - pendingAt <= LOG_INTENT_TTL_MS;
}

/** Consume the intent: true at most once per request. */
export function consumeLogIntent(now: number = Date.now()): boolean {
  const live = peekLogIntent(now);
  pendingAt = null;
  return live;
}

/** Test helper. */
export function _resetLogIntentForTests(): void {
  pendingAt = null;
}
