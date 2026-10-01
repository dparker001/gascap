/**
 * $20 Gift Campaign — shared constants (docs/GIFT20_CAMPAIGN_SPEC.md).
 *
 * Don hands out physical cards, each paperclipped to a real $20 bill. Each
 * card's QR points at /q/GIFT01…GIFT10 (CampaignPlacement rows created in
 * /admin/campaigns), which logs the scan, sets the gc_src attribution
 * cookie, and redirects to the landing page at GIFT20_LANDING_PATH.
 *
 * Kept free of server-only imports so the landing page's client islands and
 * the tracking route can share the same allowlists.
 */

export const GIFT20_CAMPAIGN     = '20dollar-gift';
export const GIFT20_LANDING_PATH = '/gift/20';

/** Placement.placement value for a handed-out card (vs. 'counter', 'window', …). */
export const CARD_PLACEMENT = 'card';

/** GIFT00 (Don's test code) through GIFT99. */
export function isGift20Code(code: string | null | undefined): boolean {
  return !!code && /^GIFT\d{2}$/i.test(code.trim());
}

/** Every CTA on the landing + thank-you pages. `cta_click` meta.cta must be one of these. */
export const GIFT20_CTAS = [
  'app_store',
  'google_play',
  'web_app',
  'see_why',
  'web_lifetime',
  'getaway_terms',
  'share',
] as const;
export type Gift20Cta = typeof GIFT20_CTAS[number];

/** Landing-page sections, in scroll order. `section_view` meta.section must be one of these. */
export const GIFT20_SECTIONS = [
  'hero',
  'choice',
  'features',
  'founder',
  'lifetime',
  'getaway',
  'updates',
] as const;
export type Gift20Section = typeof GIFT20_SECTIONS[number];

export const IOS_APP_URL     = process.env.NEXT_PUBLIC_GASCAP_IOS_APP_URL     || 'https://apps.apple.com/app/id6761315915';
export const ANDROID_APP_URL = process.env.NEXT_PUBLIC_GASCAP_ANDROID_APP_URL || 'https://play.google.com/store/apps/details?id=app.gascap.mobile';

/**
 * Version tag stored with every lead's consent record, so a later wording
 * change can be told apart from what an earlier lead actually agreed to.
 * Bump whenever the consent copy in translations (gift20.updates*) changes.
 */
export const GIFT20_CONSENT_VERSION = 'gift20-v1-2026-10-01';
