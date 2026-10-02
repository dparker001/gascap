/**
 * Client glue for Rental Mode return fallbacks (Option C, 2026-10-02).
 * Re-syncs this device's local fallbacks from the authoritative server list
 * of ACTIVE rentals — on load (calculator hook, rentals list) and after any
 * create / edit / complete / delete. A signature check makes repeated
 * renders a no-op. Native only (syncRentalReturnFallbacks no-ops on web).
 */
import { detectNativePlatform } from '@/hooks/useIsNative';
import { syncRentalReturnFallbacks, type FallbackSession } from './rentalReminder';

let lastSignature = '';

export async function syncRentalFallbacksFromSessions(userId: string | undefined, sessions: FallbackSession[]): Promise<void> {
  if (!userId) return;
  const active = sessions.filter((s) => s.status === 'active');
  const signature = `${userId}|${active.map((s) => `${s.id}:${s.returnDateTimeUtc ?? ''}`).sort().join(',')}`;
  if (signature === lastSignature) return;
  lastSignature = signature;
  await syncRentalReturnFallbacks(active, { userId, platform: detectNativePlatform() });
}

/** After a create/edit/complete/delete: refetch active rentals, then re-sync. */
export async function resyncRentalFallbacks(userId: string | undefined): Promise<void> {
  if (!userId) return;
  try {
    const res = await fetch('/api/rental-sessions?status=active');
    if (!res.ok) return;
    const d = await res.json() as { sessions?: FallbackSession[] };
    lastSignature = '';
    await syncRentalFallbacksFromSessions(userId, d.sessions ?? []);
  } catch { /* best-effort */ }
}
