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

/**
 * Phase 5C — CampaignCommunication.kind / .state canonical values. Centralized
 * here (not scattered as raw strings) per the approved architecture — both
 * lib/feedbackCampaignComms.ts (server) and app/admin/feedback-campaign/page.tsx
 * (client) import these.
 */
export const CAMPAIGN_COMMUNICATION_KINDS = ['invite_email', 'reminder_email', 'reminder_push'] as const;
export type CampaignCommunicationKind = (typeof CAMPAIGN_COMMUNICATION_KINDS)[number];

/**
 * claimed   = atomic DB claim exists; provider call has not yet resolved, or
 *             the process was interrupted before it could.
 * sent      = provider clearly accepted/confirmed — the ONLY state that may
 *             ever be reported as "sent" or trigger *_sent analytics.
 * ambiguous = provider outcome cannot be determined safely (e.g. a network
 *             exception with unknown accept/reject outcome) — never
 *             auto-retried.
 * failed    = provider definitely rejected/did not accept the communication.
 * no_channel = push-only: the user had no usable delivery channel at all
 *              (no OneSignal subscription, no APNs token) — a definite,
 *              non-error non-delivery, distinct from a provider failure.
 */
export const CAMPAIGN_COMMUNICATION_STATES = ['claimed', 'sent', 'ambiguous', 'failed', 'no_channel'] as const;
export type CampaignCommunicationState = (typeof CAMPAIGN_COMMUNICATION_STATES)[number];
