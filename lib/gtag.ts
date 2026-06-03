/**
 * GasCap™ — Google Analytics 4 utility
 * Wraps window.gtag with TypeScript types and a safe no-op fallback.
 * Import `gtagEvent` anywhere in the app to fire a custom GA4 event.
 * Measurement ID is set via NEXT_PUBLIC_GA_MEASUREMENT_ID env var (Railway).
 */

// NEXT_PUBLIC_* vars are baked in at build time by Next.js
export const GA_ID: string = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? '';

// ── Google Ads conversion tracking ────────────────────────────────────────────
// GADS_ID is the Google Ads tag (AW-XXXXXXXXX). Defaults to the live GasCap tag,
// overridable via env. GADS_SIGNUP_LABEL is the conversion-action label — set it
// in Railway (NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL) after creating the "Sign-up"
// conversion action in Google Ads. Until it's set, the conversion is a safe no-op.
export const GADS_ID: string =
  process.env.NEXT_PUBLIC_GOOGLE_ADS_ID ?? 'AW-18207815390';
export const GADS_SIGNUP_LABEL: string =
  process.env.NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL ?? '';

declare global {
  interface Window {
    gtag: (...args: unknown[]) => void;
    dataLayer: unknown[];
    fbq:  (...args: unknown[]) => void;
  }
}

/** Fire a Meta Pixel standard event (safe no-op if pixel not loaded) */
export function fbTrack(
  event: string,
  params?: Record<string, string | number | boolean>
) {
  if (typeof window === 'undefined' || !window.fbq) return;
  window.fbq('track', event, params ?? {});
}

/** Send a GA4 custom event */
export function gtagEvent(
  eventName: string,
  params?: Record<string, string | number | boolean>
) {
  if (typeof window === 'undefined' || !window.gtag || !GA_ID) return;
  window.gtag('event', eventName, params);
}

// ── GasCap™ named events ──────────────────────────────────────────────────────

/** User ran a Target Fill calculation */
export const trackCalculateTarget = () =>
  gtagEvent('calculate', { calc_type: 'target' });

/** User ran a Budget calculation */
export const trackCalculateBudget = () =>
  gtagEvent('calculate', { calc_type: 'budget' });

/** User triggered a live gas price lookup */
export const trackGasPriceLookup = () =>
  gtagEvent('gas_price_lookup');

/** User successfully created an account */
export const trackSignUp = () =>
  gtagEvent('sign_up', { method: 'credentials' });

/**
 * Fire the Google Ads "Sign-up" conversion.
 * Safe no-op until GADS_SIGNUP_LABEL is configured (env), or if gtag isn't loaded.
 */
export function trackGoogleAdsSignup() {
  if (typeof window === 'undefined' || !window.gtag) return;
  if (!GADS_ID || !GADS_SIGNUP_LABEL) return;
  window.gtag('event', 'conversion', {
    send_to: `${GADS_ID}/${GADS_SIGNUP_LABEL}`,
  });
}

/** User clicked any "Upgrade to Pro" CTA */
export const trackUpgradeClick = (source: string) =>
  gtagEvent('upgrade_click', { source });

/** User logged a fill-up */
export const trackLogFillup = () =>
  gtagEvent('log_fillup');

/** User saved a vehicle */
export const trackSaveVehicle = () =>
  gtagEvent('save_vehicle');

/** User clicked the referral share button */
export const trackReferralShare = () =>
  gtagEvent('referral_share');

/** User scanned a QR placard link (/q/[code]) */
export const trackQrScan = (code: string) =>
  gtagEvent('qr_scan', { placement_code: code });

/** User opened Google Maps from a calculation result or trip planner */
export const trackGoogleMapsOpen = (mode: string, userPlan: string) =>
  gtagEvent('google_maps_open', { mode, user_plan: userPlan });

/** User hit a Pro/Fleet feature gate (upsell prompt shown) */
export const trackLockedFeatureShown = (feature: string, userPlan: string) =>
  gtagEvent('locked_feature_shown', { feature, user_plan: userPlan });

/** User toggled rental return mode on or off */
export const trackRentalReturnToggled = (isRental: boolean) =>
  gtagEvent('rental_return_mode_toggled', { enabled: isRental });

/** User ran the Smart Fill-Up Optimizer */
export const trackFillupOptimizerRun = (state: string) =>
  gtagEvent('fillup_optimizer_run', { state });
