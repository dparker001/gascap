/**
 * Pro Lifetime + complimentary getaway promo.
 *
 * Anyone who buys Pro Lifetime ($19.99) while this promo is ACTIVE receives a
 * complimentary resort getaway certificate (fulfilled via Marketing Boost). The
 * getaway is the entire incentive — there is NO discount; Lifetime stays at full
 * price ($19.99). This keeps price integrity intact while the getaway dwarfs any
 * coupon as a reason to buy.
 *
 * Fulfillment is "Option B": on each qualifying Lifetime purchase, the webhook
 * notifies the admin (Don) to issue a Marketing Boost certificate to the buyer's
 * email (MB members area → "online bookings" type → enter recipient email). The
 * buyer is told their certificate arrives by email within 24 hours.
 *
 * ── GOING LIVE ────────────────────────────────────────────────────────────────
 * 1. Set GETAWAY_ACTIVE = true below (and optionally GETAWAY_END_DATE for urgency).
 * 2. Commit + deploy. That single flag:
 *      • shows the getaway banner + Lifetime-card badges,
 *      • turns on the webhook cert-issuance notification,
 *      • AND auto-pauses the standalone 50%-off new-member discount
 *        (NewMemberOfferBanner hides itself while this is active),
 *    so the getaway becomes the one Lifetime offer.
 *
 * Unlimited certificates can be issued (no supply cap), so the promo is
 * time-boxed for urgency, not quantity-capped.
 */

// ── Flip this to true to launch the promo ────────────────────────────────────
const GETAWAY_ACTIVE = true;

// Optional hard deadline (ISO date) for urgency — null = no deadline / standing.
// Example: '2026-06-30T23:59:59-04:00'
const GETAWAY_END_DATE: string | null = null;

/**
 * Honest disclosure facts (sourced from the Marketing Boost / RedeemVacations
 * redemption flow). Surfaced in the banner fine print and the buyer email so the
 * offer never feels like bait-and-switch.
 */
export const GETAWAY_DISCLOSURE = {
  short: 'Hotel stay only — flights not included. Room rate is complimentary (no timeshare); you cover the nightly taxes & fees (vary by destination) plus your own travel. Must be 21+, live 100+ miles from your destination, and book 30+ days ahead. Full terms at RedeemVacations.com.',
  full: [
    'No timeshare presentation and no hoops — activate online by prepaying your destination\'s hotel taxes & fees, then choose your resort and travel dates.',
    'This is a hotel stay only — flights/airfare are NOT included. The hotel room rate is free (valued up to $350/night); you cover the nightly taxes & fees (vary by destination), plus your own airfare, food, and any resort fees the hotel may charge at check-in.',
    'Activate within 7 days of receiving it; travel any time within 18 months. Book at least 30 days ahead — excludes major holidays; weekends may add a small surcharge.',
    'For up to 2 adults (at least one age 21+); some hotels allow up to 2 children under 12. No group travel — one stay per household.',
    'You must live at least 100 miles from your chosen destination, and present a major credit/debit card + government ID at check-in.',
    'Activation fees are non-refundable and the certificate is non-transferable. One incentive per household every 12 months.',
    'Fulfilled by our travel partner — you\'ll receive your certificate from Marketing Boost / RedeemVacations. Full terms at RedeemVacations.com.',
  ],
} as const;

/**
 * The curated getaway destinations a buyer can choose from after purchasing
 * Lifetime. Fees are the nightly taxes & fees the traveler prepays to activate
 * (vary by destination — sourced from the RedeemVacations catalog). The room
 * rate itself is free. Keep this list short (~6) so the choice is quick.
 */
export interface GetawayDestination {
  id:     string;   // stable slug used in the choose API + emails
  name:   string;   // display name
  vibe:   string;   // one-line hook
  emoji:  string;
  fee:    number;   // nightly taxes & fees (USD) the traveler prepays
}

export const GETAWAY_DESTINATIONS: readonly GetawayDestination[] = [
  { id: 'las-vegas',   name: 'Las Vegas, NV',   vibe: 'Shows, dining & nightlife',     emoji: '🎰', fee: 33.24 },
  { id: 'denver',      name: 'Denver, CO',      vibe: 'Mountains & winter getaway',    emoji: '🏔️', fee: 48.94 },
  { id: 'miami',       name: 'Miami, FL',       vibe: 'Beach & nightlife',             emoji: '🏖️', fee: 49.76 },
  { id: 'san-antonio', name: 'San Antonio, TX', vibe: 'Riverwalk & family fun',        emoji: '🌵', fee: 54.22 },
  { id: 'orlando',     name: 'Orlando, FL',     vibe: 'Theme parks & family',          emoji: '🎢', fee: 56.70 },
  { id: 'nashville',   name: 'Nashville, TN',   vibe: 'Live music city',               emoji: '🎸', fee: 65.59 },
] as const;

/** Look up a destination by its id (returns undefined if not one of the six). */
export function findGetawayDestination(id: string | null | undefined): GetawayDestination | undefined {
  if (!id) return undefined;
  return GETAWAY_DESTINATIONS.find((d) => d.id === id);
}

export interface GetawayOfferStatus {
  /** Promo is globally active (flag on + within any deadline) */
  active:   boolean;
  /** This specific user can claim it (active + not already Lifetime) */
  eligible: boolean;
  /** Whole days until the deadline; null when there's no deadline */
  daysLeft: number | null;
}

/** Is the getaway promo globally live right now? */
export function getawayPromoActive(): boolean {
  if (!GETAWAY_ACTIVE) return false;
  if (GETAWAY_END_DATE) {
    const end = new Date(GETAWAY_END_DATE).getTime();
    if (!Number.isNaN(end) && Date.now() > end) return false;
  }
  return true;
}

/** Whole days remaining until the deadline, or null if there's no deadline. */
export function getawayDaysLeft(): number | null {
  if (!GETAWAY_END_DATE) return null;
  const end = new Date(GETAWAY_END_DATE).getTime();
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
}

/**
 * Per-user eligibility. Anyone who isn't already on Lifetime can claim the
 * getaway by buying Lifetime while the promo is active. `stripeInterval` is the
 * billing interval from the user record.
 */
export function getawayOfferStatus(user: {
  stripeInterval?: string | null;
}): GetawayOfferStatus {
  const active = getawayPromoActive();
  const alreadyLifetime = user.stripeInterval === 'lifetime';
  return {
    active,
    eligible: active && !alreadyLifetime,
    daysLeft: getawayDaysLeft(),
  };
}
