/**
 * Next.js Instrumentation Hook
 * Runs once on server startup — registers node-cron scheduled tasks.
 *
 * Schedules:
 *   - Weekly digest push notification  → every Sunday  8:00 AM ET
 *   - Daily gas price alert check      → every day     9:00 AM ET
 *
 * Both jobs call internal protected API routes via x-cron-secret header.
 * Set CRON_SECRET in your Railway environment variables.
 */

export async function register() {
  // Only run in Node.js runtime (not Edge), and only in production or when
  // explicitly enabled in dev via ENABLE_CRON=true
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.ENABLE_CRON !== 'true'
  ) return;

  const cron      = (await import('node-cron')).default;
  const baseUrl   = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const secret    = process.env.CRON_SECRET  ?? '';

  if (!secret) {
    console.warn('[Cron] CRON_SECRET is not set — scheduled tasks disabled.');
    return;
  }

  // ── Weekly digest — every Sunday at 8:00 AM Eastern ─────────────────────
  cron.schedule(
    '0 8 * * 0',
    async () => {
      console.log('[Cron] Firing weekly digest...');
      try {
        const res  = await fetch(`${baseUrl}/api/cron/digest`, {
          method:  'POST',
          headers: { 'x-cron-secret': secret },
        });
        const data = await res.json();
        console.log('[Cron] Digest result:', data);
      } catch (err) {
        console.error('[Cron] Digest error:', err);
      }
    },
    { timezone: 'America/New_York' },
  );

  // ── Daily price check — every day at 9:00 AM Eastern ────────────────────
  cron.schedule(
    '0 9 * * *',
    async () => {
      console.log('[Cron] Firing gas price check...');
      try {
        const res  = await fetch(`${baseUrl}/api/cron/price-check`, {
          method:  'POST',
          headers: { 'x-cron-secret': secret },
        });
        const data = await res.json();
        console.log('[Cron] Price check result:', data);
      } catch (err) {
        console.error('[Cron] Price check error:', err);
      }
    },
    { timezone: 'America/New_York' },
  );

  console.log('[Cron] Scheduled → weekly digest (Sun 8am ET) · daily price check (9am ET)');
}
