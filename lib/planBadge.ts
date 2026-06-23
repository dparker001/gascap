/**
 * Shared plan-badge label/color — used by the web header (AuthButton) and the native
 * title bar so they stay in sync. Pro-trial users show a live "Pro Trial · Nd" countdown.
 */
import type { Translations } from './translations';

export interface PlanBadge {
  text:   string;
  bg:     string;
  medal?: boolean;   // 🏅 for Lifetime
}

export interface PlanUser {
  plan?:           string;
  isProTrial?:     boolean;
  stripeInterval?: string | null;
  trialExpiresAt?: string | null;
}

/** Whole days left in the trial (rounded up, min 0), or null if no/invalid expiry. */
export function trialDaysLeft(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function getPlanBadge(u: PlanUser | null | undefined, t: Translations): PlanBadge | null {
  const plan           = u?.plan ?? 'free';
  const isProTrial     = u?.isProTrial ?? false;
  const isLifetime     = plan === 'pro' && !isProTrial && u?.stripeInterval === 'lifetime';

  if (isLifetime) return { text: t.plan.lifetimeShort, bg: 'bg-teal-600', medal: true };

  if (plan === 'pro' && isProTrial) {
    const d = trialDaysLeft(u?.trialExpiresAt);
    return {
      text: d != null ? `${t.plan.proTrialShort} · ${d}d` : t.plan.proTrialShort,
      bg:   'bg-brand-orange',
    };
  }

  if (plan === 'pro')   return { text: t.plan.proShort,   bg: 'bg-brand-orange' };
  if (plan === 'fleet') return { text: t.plan.fleetShort, bg: 'bg-blue-600' };
  return null;
}
