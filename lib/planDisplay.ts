/**
 * Pure decision logic for the Settings → Plan card, extracted so the
 * trial-vs-paid-Pro distinction can be regression-tested without needing
 * to render app/settings/page.tsx.
 *
 * Fixed a bug where a Pro TRIAL user on iOS was shown "PRO" and "Manage
 * your subscription in your iPhone Settings" — implying a real Apple
 * subscription that doesn't exist yet — instead of an Upgrade CTA. Web
 * and Android behavior are unchanged; only the iOS trial case is
 * special-cased.
 */

export interface PlanCardInput {
  plan: string;
  isProTrial: boolean;
  isProLifetime: boolean;
  isIos: boolean;
}

export type PlanCardCta =
  | 'ios-trial-upgrade'   // Pro trial on iOS — Upgrade/Subscribe CTA to /upgrade, never Apple-manage text
  | 'apple-manage'        // paid Pro on iOS — "manage in iPhone Settings"
  | 'other-pro-block'     // any other plan==='pro' case (web/Android, trial or paid) — existing behavior, unchanged
  | 'none';                // not plan==='pro' at all (free/fleet handled elsewhere)

/**
 * Which CTA the Pro plan-card block should show. Mirrors
 * app/settings/page.tsx's JSX conditions exactly — keep in sync if either
 * changes.
 */
export function resolvePlanCardCta(input: PlanCardInput): PlanCardCta {
  if (input.plan !== 'pro') return 'none';
  if (input.isProTrial && input.isIos) return 'ios-trial-upgrade';
  if (input.isProLifetime) return 'none'; // Lifetime has its own block, not this one
  if (input.isIos) return 'apple-manage'; // paid Pro (monthly/annual), not trial
  return 'other-pro-block';
}

/** Which plan label to show. */
export function resolvePlanLabel(input: { plan: string; isProTrial: boolean; isProLifetime: boolean; isProAnnual: boolean }): 'lifetime' | 'annual' | 'trial' | 'plain' {
  if (input.isProLifetime) return 'lifetime';
  if (input.isProAnnual) return 'annual';
  if (input.plan === 'pro' && input.isProTrial) return 'trial';
  return 'plain';
}
