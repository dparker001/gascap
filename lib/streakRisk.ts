/**
 * Streak-reminder eligibility.
 *
 * Deliberately its own module with zero imports: lib/users.ts pulls in the
 * email and giveaway graph, which makes this un-unit-testable, and a
 * notification that fires at every user in the database is exactly the kind
 * of logic that needs tests.
 */

/**
 * Is this user's streak actually at risk tonight?
 *
 * The streak reminder used to gate on lastLoginAt, which is only written by
 * recordLogin — and recordLogin fires on a SIGN-IN, not on opening the app.
 * Sessions here are long-lived JWTs, so someone who signed in once and has
 * used the app every day since keeps a months-old lastLoginAt. They got
 * "your streak is at risk" every single night while their streak was
 * perfectly safe, which teaches people to ignore the notification that
 * matters.
 *
 * activeDays is the right source: it's what calcStreak reads, and it's
 * stamped by the 'visit' event every time the app is opened. Checking
 * anything else means the reminder and the streak disagree.
 *
 * Compares with >= rather than equality because activeDays entries use the
 * CLIENT's local date. At 23:00 UTC a user ahead of UTC has already rolled
 * over to tomorrow, and their entry must not read as "not today".
 */
export function isStreakAtRisk(
  activeDays: string[] | null | undefined,
  lastLoginAt: string | null | undefined,
  todayUTC: string,
): boolean {
  const days = activeDays ?? [];
  const latest = days.length > 0 ? days.reduce((a, b) => (a > b ? a : b)) : '';
  if (latest >= todayUTC) return false;              // opened the app today (or later, ahead of UTC)
  if ((lastLoginAt ?? '').startsWith(todayUTC)) return false;  // fresh sign-in today
  return true;
}
