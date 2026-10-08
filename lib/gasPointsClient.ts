'use client';

/**
 * Gamification G1 — client helper to surface a server-decided award.
 *
 * It only DISPLAYS what the server already awarded (the response carried
 * `gasPointsAwarded`). It cannot grant, change or request points.
 */
import { isGasPointAction, type AwardSummary } from './gasPointsRules';

export const GASPOINTS_AWARDED_EVENT = 'gaspoints:awarded';

export function announceGasPoints(award: unknown): void {
  try {
    if (!award || typeof award !== 'object') return;
    const a = award as Partial<AwardSummary>;
    if (!isGasPointAction(a.action) || typeof a.points !== 'number' || !(a.points > 0)) return;
    window.dispatchEvent(new CustomEvent(GASPOINTS_AWARDED_EVENT, { detail: { action: a.action, points: a.points } }));
  } catch { /* a reward toast must never break the real action */ }
}
