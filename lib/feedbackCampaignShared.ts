/**
 * Phase 5A — Feedback Campaign constants safe for BOTH client and server
 * code. lib/feedbackCampaign.ts imports the Prisma client (server-only via
 * `pg`), so a 'use client' component (app/feedback/page.tsx) must import
 * these enum values from here instead — importing them from
 * lib/feedbackCampaign.ts directly pulls `pg`'s Node-only `net`/`tls`
 * dependencies into the client bundle and fails the build (see
 * feedback_verify_with_real_build.md memory: `tsc --noEmit` doesn't catch
 * this, only `npm run build` does).
 */
export const PRIMARY_FEATURE_OPTIONS = [
  'fuel_calculator',
  'target_fill',
  'budget_mode',
  'gas_prices',
  'saved_vehicles',
  'rental_return',
  'other',
] as const;
export type PrimaryFeature = (typeof PRIMARY_FEATURE_OPTIONS)[number];

export const PMF_OPTIONS = ['very', 'somewhat', 'not'] as const;
export type PmfResponse = (typeof PMF_OPTIONS)[number];

export const RENTAL_HELPFULNESS_OPTIONS = ['yes', 'somewhat', 'no'] as const;
export type RentalHelpfulness = (typeof RENTAL_HELPFULNESS_OPTIONS)[number];
